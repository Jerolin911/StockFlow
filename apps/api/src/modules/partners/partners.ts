import { Router } from 'express';
import { Schema, model, type FilterQuery, type SchemaDefinition, type Types } from 'mongoose';
import type { z } from 'zod';
import {
  createCustomerSchema,
  createSupplierSchema,
  listPartnersQuerySchema,
  updateCustomerSchema,
  updateSupplierSchema,
  type CustomerDto,
  type PartnerDto,
  type Permission,
  type SupplierDto,
} from '@stockflow/shared';
import { nextSequence } from '../../lib/counters.js';
import { AppError, isDuplicateKeyError, notFound } from '../../lib/errors.js';
import { escapeRegex, parseId, parseSort } from '../../lib/http.js';
import { authenticate, authorize } from '../../middleware/auth.js';

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

interface PartnerConfig<TRecord extends PartnerRecord, TDto extends PartnerDto> {
  modelName: string;
  label: string;
  codePrefix: string;
  permission: Permission;
  extraFields: SchemaDefinition;
  createSchema: z.ZodType<{ code: string } & Record<string, unknown>>;
  updateSchema: z.ZodType<Record<string, unknown>>;
  toExtra: (row: TRecord) => Omit<TDto, keyof PartnerDto>;
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

  const Model = model(config.modelName, schema);

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

  const codeTaken = () =>
    new AppError(409, 'CONFLICT', `A ${config.label} with this code already exists`, [
      { path: 'code', message: 'This code is already in use' },
    ]);

  async function create(input: { code: string } & Record<string, unknown>) {
    if (input.code) {
      try {
        return await Model.create(input);
      } catch (error) {
        if (isDuplicateKeyError(error)) throw codeTaken();
        throw error;
      }
    }
    for (let attempt = 0; attempt < 25; attempt++) {
      const seq = await nextSequence(`partner:${config.codePrefix}`);
      try {
        return await Model.create({
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
      const filter: FilterQuery<PartnerRecord> = {};
      if (query.status) filter.isActive = query.status === 'active';
      if (query.search) {
        const pattern = new RegExp(escapeRegex(query.search), 'i');
        filter.$or = [
          { name: pattern },
          { code: pattern },
          { email: pattern },
          { contactName: pattern },
        ];
      }
      const [rows, total] = await Promise.all([
        Model.find(filter)
          .sort({ ...parseSort(query.sort), _id: 1 })
          .skip((query.page - 1) * query.pageSize)
          .limit(query.pageSize)
          .lean<TRecord[]>(),
        Model.countDocuments(filter),
      ]);
      res.json({
        data: rows.map(toDto),
        meta: { page: query.page, pageSize: query.pageSize, total },
      });
    });

    r.get('/:id', async (req, res) => {
      const row = await Model.findById(parseId(req.params.id, config.label)).lean<TRecord>();
      if (!row) throw notFound(capitalise(config.label));
      res.json({ data: toDto(row) });
    });

    r.post('/', authorize(config.permission), async (req, res) => {
      const doc = await create(config.createSchema.parse(req.body));
      res.status(201).json({ data: toDto(doc.toObject() as unknown as TRecord) });
    });

    r.patch('/:id', authorize(config.permission), async (req, res) => {
      const input = config.updateSchema.parse(req.body);
      const doc = await Model.findById(parseId(req.params.id, config.label));
      if (!doc) throw notFound(capitalise(config.label));
      doc.set(input);
      await doc.save();
      res.json({ data: toDto(doc.toObject() as unknown as TRecord) });
    });

    return r;
  }

  return { Model, router, create };
}

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

type SupplierRecord = PartnerRecord & { leadTimeDays: number | null };
type CustomerRecord = PartnerRecord & { shippingAddress: string };

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
  extraFields: { shippingAddress: { type: String, default: '' } },
  createSchema: createCustomerSchema,
  updateSchema: updateCustomerSchema,
  toExtra: (row) => ({ shippingAddress: row.shippingAddress ?? '' }),
});
