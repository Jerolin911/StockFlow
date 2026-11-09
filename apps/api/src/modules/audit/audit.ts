import { Router, type RequestHandler } from 'express';
import { Schema, Types, model, type FilterQuery } from 'mongoose';
import { listAuditLogsQuerySchema, type AuditLogDto } from '@stockflow/shared';
import { escapeRegex } from '../../lib/http.js';
import { authenticate, authorize } from '../../middleware/auth.js';

const auditLogSchema = new Schema(
  {
    at: { type: Date, required: true },
    actor: {
      type: new Schema(
        { _id: Schema.Types.ObjectId, name: String, role: String, email: String },
        { _id: false },
      ),
      default: null,
    },
    method: { type: String, required: true },
    /** Route pattern, e.g. /purchase-orders/:id/approve. */
    action: { type: String, required: true },
    path: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, default: null },
    status: { type: Number, required: true },
    ip: { type: String, default: '' },
    requestId: { type: String, default: '' },
  },
  { versionKey: false },
);
auditLogSchema.index({ at: -1 });
auditLogSchema.index({ 'actor._id': 1, at: -1 });
auditLogSchema.index({ entityType: 1, at: -1 });
auditLogSchema.index({ entityId: 1, at: -1 });

export const AuditLog = model('AuditLog', auditLogSchema);

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
// Session housekeeping and read receipts aren't changes worth auditing.
const SKIP = [/^\/auth\/(refresh|logout)$/, /^\/notifications\//];

/**
 * Records every successful change (and every sign-in attempt) after the response is sent:
 * who, what route, which record, and the outcome. Reads aren't logged; document histories
 * and the movement ledger hold the business detail.
 */
export function auditTrail(): RequestHandler {
  return (req, res, next) => {
    if (!MUTATING.has(req.method)) return next();
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      const id = (body as { data?: { id?: unknown } } | undefined)?.data?.id;
      if (typeof id === 'string') res.locals.auditEntityId = id;
      return json(body);
    };
    res.on('finish', () => {
      const path = req.originalUrl.split('?')[0]!.replace(/^\/api\/v1/, '');
      if (SKIP.some((pattern) => pattern.test(path))) return;
      const isLogin = path === '/auth/login';
      if (!isLogin && res.statusCode >= 400) return;
      const pattern = req.route?.path
        ? `${req.baseUrl.replace(/^\/api\/v1/, '')}${req.route.path}`
        : path;
      const user = req.auth?.user;
      const email = isLogin ? (req.body as { email?: unknown } | undefined)?.email : undefined;
      void AuditLog.create({
        at: new Date(),
        actor: user
          ? {
              _id: new Types.ObjectId(user.id),
              name: user.name,
              role: user.role,
              email: user.email,
            }
          : typeof email === 'string'
            ? { email: email.trim().toLowerCase().slice(0, 254) }
            : null,
        method: req.method,
        action: pattern.replace(/\/$/, '') || '/',
        path,
        entityType: path.split('/')[1] ?? '',
        entityId:
          (typeof req.params.id === 'string' ? req.params.id : null) ??
          (res.locals.auditEntityId as string | undefined) ??
          null,
        status: res.statusCode,
        ip: req.ip ?? '',
        requestId: String(req.id ?? ''),
      }).catch((error: unknown) => req.log.error({ err: error }, 'Could not write audit log'));
    });
    next();
  };
}

export function createAuditRouter(): Router {
  const router = Router();
  router.use(authenticate(), authorize('audit:read'));

  router.get('/', async (req, res) => {
    const query = listAuditLogsQuerySchema.parse(req.query);
    const filter: FilterQuery<unknown> = {};
    if (query.actorId) filter['actor._id'] = new Types.ObjectId(query.actorId);
    if (query.entityType) filter.entityType = query.entityType;
    if (query.entityId) filter.entityId = query.entityId;
    if (query.outcome === 'failed') filter.status = { $gte: 400 };
    if (query.search) {
      const pattern = new RegExp(escapeRegex(query.search), 'i');
      filter.$or = [
        { action: pattern },
        { path: pattern },
        { 'actor.name': pattern },
        { 'actor.email': pattern },
      ];
    }
    if (query.from || query.to) {
      filter.at = {
        ...(query.from ? { $gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
        ...(query.to ? { $lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
      };
    }
    const [rows, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ at: -1, _id: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);
    const data: AuditLogDto[] = rows.map((r) => ({
      id: r._id.toString(),
      at: r.at.toISOString(),
      actor: r.actor
        ? {
            id: r.actor._id ? r.actor._id.toString() : null,
            name: r.actor.name ?? '',
            role: r.actor.role ?? '',
            email: r.actor.email ?? '',
          }
        : null,
      method: r.method,
      action: r.action,
      path: r.path,
      entityType: r.entityType,
      entityId: r.entityId ?? null,
      status: r.status,
      ip: r.ip,
    }));
    res.json({ data, meta: { page: query.page, pageSize: query.pageSize, total } });
  });

  return router;
}
