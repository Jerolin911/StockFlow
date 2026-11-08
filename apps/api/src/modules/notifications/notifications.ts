import { Router } from 'express';
import { Schema, Types, model, type ClientSession, type FilterQuery } from 'mongoose';
import {
  NOTIFICATION_TYPES,
  ROLES,
  hasPermission,
  listNotificationsQuerySchema,
  type NotificationDto,
  type NotificationType,
  type PendingApprovalsDto,
  type Permission,
} from '@stockflow/shared';
import { notFound } from '../../lib/errors.js';
import { parseId } from '../../lib/http.js';
import { authenticate, requireAuth } from '../../middleware/auth.js';
import { User } from '../users/user.model.js';

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    link: { type: String, default: '' },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });

export const Notification = model('Notification', notificationSchema);

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}

export interface Recipients {
  /** Everyone whose role grants any of these permissions. */
  permissions?: Permission[];
  userIds?: (string | Types.ObjectId | null | undefined)[];
  /** The person who acted doesn't need telling. */
  exclude?: string;
}

/**
 * Creates a notification for each active recipient. Pass the posting transaction's session
 * so notifications exist only if the action they describe commits.
 */
export async function notify(to: Recipients, input: NotificationInput, session?: ClientSession) {
  const ids = new Set<string>();
  for (const id of to.userIds ?? []) if (id) ids.add(id.toString());
  const roles = ROLES.filter((role) => (to.permissions ?? []).some((p) => hasPermission(role, p)));
  const filter: FilterQuery<unknown> = { isActive: true };
  if (roles.length > 0 && ids.size > 0) {
    filter.$or = [
      { role: { $in: roles } },
      { _id: { $in: [...ids].map((id) => new Types.ObjectId(id)) } },
    ];
  } else if (roles.length > 0) {
    filter.role = { $in: roles };
  } else if (ids.size > 0) {
    filter._id = { $in: [...ids].map((id) => new Types.ObjectId(id)) };
  } else {
    return;
  }
  const users = await User.find(filter, { _id: 1 })
    .session(session ?? null)
    .lean();
  const recipients = users.filter((u) => u._id.toString() !== to.exclude);
  if (recipients.length === 0) return;
  await Notification.insertMany(
    recipients.map((u) => ({
      userId: u._id,
      type: input.type,
      title: input.title,
      body: input.body ?? '',
      link: input.link ?? '',
    })),
    session ? { session } : {},
  );
}

const toDto = (n: {
  _id: Types.ObjectId;
  type: string;
  title: string;
  body: string;
  link: string;
  readAt?: Date | null;
  createdAt: Date;
}): NotificationDto => ({
  id: n._id.toString(),
  type: n.type as NotificationType,
  title: n.title,
  body: n.body,
  link: n.link,
  readAt: n.readAt ? n.readAt.toISOString() : null,
  createdAt: n.createdAt.toISOString(),
});

/** Documents waiting for this user's approval, given their permissions (own items excluded). */
async function pendingApprovals(user: {
  id: string;
  role: (typeof ROLES)[number];
}): Promise<PendingApprovalsDto> {
  // Imported lazily: these modules import notify(), so a top-level import would be circular.
  const [
    { PurchaseOrder, PurchaseRequest },
    { StockTransfer, StockCount },
    { CustomerReturn, SupplierReturn },
  ] = await Promise.all([
    import('../purchasing/models.js'),
    import('../warehouse-ops/models.js'),
    import('../returns/models.js'),
  ]);
  const can = (p: Permission) => hasPermission(user.role, p);
  const self = new Types.ObjectId(user.id);
  const notMine = (field: string) => (user.role === 'admin' ? {} : { [field]: { $ne: self } });
  const count = (enabled: boolean, run: () => Promise<number>) =>
    enabled ? run() : Promise.resolve(0);
  const [
    purchaseRequests,
    purchaseOrders,
    transfers,
    customerReturns,
    supplierReturns,
    stockCounts,
  ] = await Promise.all([
    count(can('purchaseRequests:approve'), () =>
      PurchaseRequest.countDocuments({ status: 'submitted', ...notMine('requestedBy._id') }),
    ),
    count(can('purchaseOrders:approve'), () =>
      PurchaseOrder.countDocuments({ status: 'pending_approval', ...notMine('createdBy._id') }),
    ),
    count(can('transfers:approve'), () =>
      StockTransfer.countDocuments({ status: 'requested', ...notMine('requestedBy._id') }),
    ),
    count(can('customerReturns:write'), () =>
      CustomerReturn.countDocuments({ status: 'requested' }),
    ),
    count(can('supplierReturns:approve'), () =>
      SupplierReturn.countDocuments({ status: 'requested' }),
    ),
    count(can('stock:adjust'), () => StockCount.countDocuments({ status: 'submitted' })),
  ]);
  return {
    purchaseRequests,
    purchaseOrders,
    transfers,
    customerReturns,
    supplierReturns,
    stockCounts,
    total:
      purchaseRequests +
      purchaseOrders +
      transfers +
      customerReturns +
      supplierReturns +
      stockCounts,
  };
}

export function createNotificationsRouter(): Router {
  const router = Router();
  router.use(authenticate());

  router.get('/', async (req, res) => {
    const query = listNotificationsQuerySchema.parse(req.query);
    const { user } = requireAuth(req);
    const filter: FilterQuery<unknown> = { userId: new Types.ObjectId(user.id) };
    if (query.type) filter.type = query.type;
    if (query.unread) filter.readAt = null;
    const [rows, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean(),
      Notification.countDocuments(filter),
    ]);
    res.json({
      data: rows.map(toDto),
      meta: { page: query.page, pageSize: query.pageSize, total },
    });
  });

  router.get('/summary', async (req, res) => {
    const { user } = requireAuth(req);
    const [unread, approvals] = await Promise.all([
      Notification.countDocuments({ userId: new Types.ObjectId(user.id), readAt: null }),
      pendingApprovals(user),
    ]);
    res.json({ data: { unread, approvals } });
  });

  router.post('/read-all', async (req, res) => {
    const { user } = requireAuth(req);
    const result = await Notification.updateMany(
      { userId: new Types.ObjectId(user.id), readAt: null },
      { $set: { readAt: new Date() } },
    );
    res.json({ data: { updated: result.modifiedCount } });
  });

  router.post('/:id/read', async (req, res) => {
    const { user } = requireAuth(req);
    const id = parseId(req.params.id, 'Notification');
    // Scoped to the owner: another user's id looks the same as a missing one.
    const updated = await Notification.findOneAndUpdate(
      { _id: id, userId: new Types.ObjectId(user.id) },
      [{ $set: { readAt: { $ifNull: ['$readAt', '$$NOW'] } } }],
      { new: true },
    ).lean();
    if (!updated) throw notFound('Notification');
    res.json({ data: toDto(updated) });
  });

  return router;
}
