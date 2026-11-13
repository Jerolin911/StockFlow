import { Router } from 'express';
import {
  Schema,
  Types,
  model,
  type FilterQuery,
  type Model,
  type SchemaDefinition,
} from 'mongoose';
import type { z } from 'zod';
import {
  createCustomerSchema,
  createSupplierSchema,
  eraseCustomerSchema,
  listPartnersQuerySchema,
  updateCustomerSchema,
  updateSupplierSchema,
  type CustomerDto,
  type PartnerDto,
  type Permission,
  type SupplierDto,
} from '@stockflow/shared';
import { env } from '../../config/env.js';
import { nextSequence } from '../../lib/counters.js';
import { AppError, invalidState, isDuplicateKeyError, notFound } from '../../lib/errors.js';
import { escapeRegex, parseId, parseSort } from '../../lib/http.js';
import { inTransaction } from '../../lib/transaction.js';
import { authenticate, authorize, requireAuth } from '../../middleware/auth.js';
import { userSnapshotSchema } from '../common/schemas.js';
import { eraseCustomer } from '../privacy/customer-erasure.js';
import { openCustomerData, sealCustomerData } from '../privacy/customer-data.js';
import { createCustomerKey, loadCustomerKeys } from '../privacy/customer-keys.js';
import { blindIndex } from '../privacy/field-crypto.js';

interface PartnerRecord {
  _id: Types.ObjectId;
  code: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** How a partner type stores, reads and searches its records. */
interface PartnerStorage<TRecord extends PartnerRecord> {
  /** Inserts a new record from validated input. */
  insert: (fields: Record<string, unknown>) => Promise<TRecord>;
  /** Applies validated changes; `null` when the record doesn't exist. */
  update: (id: string, input: Record<string, unknown>) => Promise<TRecord | null>;
  /** Turns stored rows into readable ones. */
  read: (rows: TRecord[]) => Promise<TRecord[]>;
  /** Search conditions for a list search term, ORed together. */
  search: (term: string) => FilterQuery<TRecord>[];
}

interface PartnerConfig<TRecord extends PartnerRecord, TDto extends PartnerDto> {
  modelName: string;
  label: string;
  codePrefix: string;
  permission: Permission;
  extraFields: SchemaDefinition;
  createSchema: z.ZodType<{ code: string } & Record<string, unknown>>;
  updateSchema: z.ZodType<Record<string, unknown>>;
  toExtra: (row: TRecord) => Omit<TDto, keyof PartnerDto>;
  /** Defaults to storing every field as given. */
  storage?: (Model: Model<TRecord>) => PartnerStorage<TRecord>;
  /** Adds routes beyond list, get, create and update. */
  routes?: (r: Router, Model: Model<TRecord>, readOne: (row: TRecord) => Promise<TDto>) => void;
}

function plainStorage<TRecord extends PartnerRecord>(
  Model: Model<TRecord>,
): PartnerStorage<TRecord> {
  return {
    insert: async (fields) => (await Model.create(fields)).toObject() as unknown as TRecord,
    update: async (id, input) => {
      const doc = await Model.findById(id);
      if (!doc) return null;
      doc.set(input);
      await doc.save();
      return doc.toObject() as unknown as TRecord;
    },
    read: (rows) => Promise.resolve(rows),
    search: (term) => {
      const pattern = new RegExp(escapeRegex(term), 'i');
      return [{ name: pattern }, { code: pattern }, { email: pattern }, { contactName: pattern }];
    },
  };
}

function definePartner<TRecord extends PartnerRecord, TDto extends PartnerDto>(
  config: PartnerConfig<TRecord, TDto>,
) {
  const schema = new Schema(
    {
      code: { type: String, required: true, uppercase: true, trim: true, immutable: true },
      name: { type: String, required: true, trim: true, maxlength: 150 },
      contactName: { type: String, default: '' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
      address: { type: String, default: '' },
      notes: { type: String, default: '' },
      isActive: { type: Boolean, required: true, default: true },
      ...config.extraFields,
    },
    { timestamps: true },
  );
  schema.index({ code: 1 }, { unique: true });
  schema.index({ isActive: 1, name: 1 });

  const Model = model(config.modelName, schema) as unknown as Model<TRecord>;
  const storage = (config.storage ?? plainStorage)(Model);

  const toDto = (row: TRecord): TDto =>
    ({
      id: row._id.toString(),
      code: row.code,
      name: row.name,
      contactName: row.contactName,
      email: row.email,
      phone: row.phone,
      address: row.address,
      notes: row.notes,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...config.toExtra(row),
    }) as TDto;

  const readOne = async (row: TRecord) => toDto((await storage.read([row]))[0]!);

  const codeTaken = () =>
    new AppError(409, 'CONFLICT', `A ${config.label} with this code already exists`, [
      { path: 'code', message: 'This code is already in use' },
    ]);

  async function create(input: { code: string } & Record<string, unknown>): Promise<TRecord> {
    if (input.code) {
      try {
        return await storage.insert(input);
      } catch (error) {
        if (isDuplicateKeyError(error)) throw codeTaken();
        throw error;
      }
    }
    for (let attempt = 0; attempt < 25; attempt++) {
      const seq = await nextSequence(`partner:${config.codePrefix}`);
      try {
        return await storage.insert({
          ...input,
          code: `${config.codePrefix}-${String(seq).padStart(4, '0')}`,
        });
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
    }
    throw new AppError(409, 'CONFLICT', 'Could not generate a unique code. Enter one manually.');
  }

  function router(): Router {
    const r = Router();
    r.use(authenticate());

    r.get('/', async (req, res) => {
      const query = listPartnersQuerySchema.parse(req.query);
      const filter: FilterQuery<TRecord> = {};
      if (query.status) filter.isActive = query.status === 'active';
      if (query.search) filter.$or = storage.search(query.search);
      const [rows, total] = await Promise.all([
        Model.find(filter)
          .sort({ ...parseSort(query.sort), _id: 1 })
          .skip((query.page - 1) * query.pageSize)
          .limit(query.pageSize)
          .lean<TRecord[]>(),
        Model.countDocuments(filter),
      ]);
      res.json({
        data: (await storage.read(rows)).map(toDto),
        meta: { page: query.page, pageSize: query.pageSize, total },
      });
    });

    r.get('/:id', async (req, res) => {
      const row = await Model.findById(parseId(req.params.id, config.label)).lean<TRecord>();
      if (!row) throw notFound(capitalise(config.label));
      res.json({ data: await readOne(row) });
    });

    r.post('/', authorize(config.permission), async (req, res) => {
      const row = await create(config.createSchema.parse(req.body));
      res.status(201).json({ data: await readOne(row) });
    });

    r.patch('/:id', authorize(config.permission), async (req, res) => {
      const input = config.updateSchema.parse(req.body);
      const row = await storage.update(parseId(req.params.id, config.label), input);
      if (!row) throw notFound(capitalise(config.label));
      res.json({ data: await readOne(row) });
    });

    config.routes?.(r, Model, readOne);
    return r;
  }

  return { Model, router, create, readOne };
}

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

type SupplierRecord = PartnerRecord & { leadTimeDays: number | null };
export type CustomerRecord = PartnerRecord & {
  shippingAddress: string;
  emailIndex?: string | null;
  erasedAt?: Date | null;
};

/**
 * Customers' personal fields are encrypted with the customer's own data key (see
 * modules/privacy). A new customer and its key are inserted in one transaction. Email search
 * is an exact match on a keyed hash (blind index); contact names can't be searched.
 */
function customerStorage(Model: Model<CustomerRecord>): PartnerStorage<CustomerRecord> {
  return {
    insert: (fields) =>
      inTransaction(async (session) => {
        const _id = new Types.ObjectId();
        const dataKey = await createCustomerKey(_id, session);
        const [doc] = await Model.create(
          [{ ...fields, ...sealCustomerData(_id, dataKey, fields), _id }],
          { session },
        );
        return doc!.toObject() as unknown as CustomerRecord;
      }),
    update: async (id, input) => {
      if (!(await Model.exists({ _id: id }))) return null;
      const dataKey = (await loadCustomerKeys([id])).get(id);
      // Conditional on not being erased, so an edit racing an erasure can't write data back.
      const updated = dataKey
        ? await Model.findOneAndUpdate(
            { _id: id, erasedAt: null },
            { $set: { ...input, ...sealCustomerData(id, dataKey, input) } },
            { new: true, runValidators: true },
          ).lean<CustomerRecord>()
        : null;
      if (!updated) {
        throw invalidState("This customer's personal data was erased, so it can't be edited");
      }
      return updated;
    },
    read: async (rows) => {
      const keys = await loadCustomerKeys(rows.map((r) => r._id));
      return rows.map((r) => ({
        ...r,
        ...openCustomerData(r._id, keys.get(r._id.toString()) ?? null, r),
      }));
    },
    search: (term) => {
      const pattern = new RegExp(escapeRegex(term), 'i');
      const emailIndex = blindIndex(env.BLIND_INDEX_KEY, term);
      return [{ name: pattern }, { code: pattern }, ...(emailIndex ? [{ emailIndex }] : [])];
    },
  };
}

export const suppliers = definePartner<SupplierRecord, SupplierDto>({
  modelName: 'Supplier',
  label: 'supplier',
  codePrefix: 'SUP',
  permission: 'suppliers:write',
  extraFields: { leadTimeDays: { type: Number, default: null, min: 0, max: 365 } },
  createSchema: createSupplierSchema,
  updateSchema: updateSupplierSchema,
  toExtra: (row) => ({ leadTimeDays: row.leadTimeDays ?? null }),
});

export const customers = definePartner<CustomerRecord, CustomerDto>({
  modelName: 'Customer',
  label: 'customer',
  codePrefix: 'CUS',
  permission: 'customers:write',
  extraFields: {
    shippingAddress: { type: String, default: '' },
    // Keyed hash of the email for exact-match search; null when there's no email.
    emailIndex: { type: String, default: null, index: true },
    erasedAt: { type: Date, default: null },
    erasedBy: { type: userSnapshotSchema, default: null },
    erasureReason: { type: String, default: '' },
  },
  createSchema: createCustomerSchema,
  updateSchema: updateCustomerSchema,
  toExtra: (row) => ({
    shippingAddress: row.shippingAddress ?? '',
    erasedAt: row.erasedAt ? row.erasedAt.toISOString() : null,
  }),
  storage: customerStorage,
  routes: (r, Model, readOne) => {
    r.post('/:id/erase', authorize('customers:erase'), async (req, res) => {
      const id = parseId(req.params.id, 'customer');
      const input = eraseCustomerSchema.parse(req.body);
      const { user } = requireAuth(req);
      await eraseCustomer(Model, id, input, { _id: new Types.ObjectId(user.id), name: user.name });
      res.json({ data: await readOne((await Model.findById(id).lean<CustomerRecord>())!) });
    });
  },
});
