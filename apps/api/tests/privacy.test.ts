import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CategoryDto,
  CustomerDto,
  ProductDto,
  SalesOrderDto,
  ShipmentDto,
  WarehouseDto,
} from '@stockflow/shared';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { parseKeyring, type Keyring } from '../src/lib/keyring.js';
import { customers } from '../src/modules/partners/partners.js';
import { openCustomerData } from '../src/modules/privacy/customer-data.js';
import {
  CustomerKey,
  loadCustomerKeys,
  rewrapCustomerKeys,
} from '../src/modules/privacy/customer-keys.js';
import { encryptExistingCustomerData } from '../src/modules/privacy/encrypt-existing.js';
import {
  DecryptionError,
  blindIndex,
  isSealed,
  openValue,
  sealValue,
} from '../src/modules/privacy/field-crypto.js';
import { SalesOrder, Shipment } from '../src/modules/sales/models.js';
import {
  api,
  createCategory,
  createCustomer,
  createProduct,
  createWarehouse,
  expectLedgerConsistent,
  openingStock,
  tokenFor,
  type Api,
} from './fixtures.js';

const app = createApp();
let admin: Api;
let sales: Api; // sales manager: customers:write, but not customers:erase
let staff: Api;
let warehouse: WarehouseDto;
let category: CategoryDto;
let widget: ProductDto;

const PERSONAL = {
  contactName: 'Dana Whitfield',
  email: 'dana.whitfield@harbor.example', // the schema lowercases emails
  phone: '+44 20 7946 0001',
  address: '1 Billing St, Leeds',
  shippingAddress: '9 Dock Rd, Hull',
  notes: 'Prefers morning deliveries',
};

beforeEach(async () => {
  admin = api(app, await tokenFor(app, 'admin'));
  sales = api(app, await tokenFor(app, 'sales_manager'));
  staff = api(app, await tokenFor(app, 'staff'));
  category = await createCategory(admin, { code: 'PRV' });
  warehouse = await createWarehouse(admin, { code: 'PRV' });
  widget = await createProduct(admin, category.id, { name: 'Widget', sellingPrice: 1000 });
  await openingStock(admin, warehouse.id, [{ productId: widget.id, quantity: 20, unitCost: 600 }]);
});

afterEach(async () => {
  await expectLedgerConsistent();
});

const rawCustomer = (id: string) =>
  customers.Model.collection.findOne({ _id: new Types.ObjectId(id) });
const rawOrder = (id: string) => SalesOrder.collection.findOne({ _id: new Types.ObjectId(id) });
const rawShipment = (id: string) => Shipment.collection.findOne({ _id: new Types.ObjectId(id) });

async function order(customer: CustomerDto, confirm = true, client: Api = sales) {
  const res = await client.post('/sales-orders', {
    customerId: customer.id,
    warehouseId: warehouse.id,
    lines: [{ productId: widget.id, quantity: 2 }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  if (!confirm) return res.body.data as SalesOrderDto;
  const confirmed = await client.post(`/sales-orders/${res.body.data.id}/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  return confirmed.body.data as SalesOrderDto;
}

/** Ships the whole order and records delivery. */
async function deliverAll(so: SalesOrderDto) {
  const created = await staff.post('/shipments', {
    salesOrderId: so.id,
    lines: so.lines.map((l) => ({ soLineId: l.id, quantity: l.quantity })),
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const shipment = created.body.data as ShipmentDto;
  await staff
    .post(`/shipments/${shipment.id}/pick`, {
      shortPickReason: '',
      lines: shipment.lines.map((l) => ({ lineId: l.id, pickedQuantity: l.quantity })),
    })
    .expect(200);
  await staff
    .post(`/shipments/${shipment.id}/pack`, { packageCount: 1, weightGrams: 1000 })
    .expect(200);
  await staff
    .post(`/shipments/${shipment.id}/dispatch`, { carrier: 'Northline', trackingNumber: 'T1' })
    .expect(200);
  await staff
    .post(`/shipments/${shipment.id}/tracking`, { type: 'delivered', receivedBy: 'D. W.' })
    .expect(200);
  return shipment;
}

const erase = (customer: CustomerDto, client: Api = admin, confirmCode = customer.code) =>
  client.post(`/customers/${customer.id}/erase`, {
    reason: 'Erasure request from the customer',
    confirmCode,
  });

describe('field encryption', () => {
  const key = randomBytes(32);

  it('round-trips values and keeps empty strings empty', () => {
    const sealed = sealValue(key, 'c1:email', 'a@b.example');
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain('a@b');
    expect(openValue(key, 'c1:email', sealed)).toBe('a@b.example');
    expect(sealValue(key, 'c1:email', '')).toBe('');
    expect(openValue(key, 'c1:email', '')).toBe('');
    // A fresh IV each time: equal values don't produce equal ciphertexts.
    expect(sealValue(key, 'c1:email', 'a@b.example')).not.toBe(sealed);
  });

  it('refuses tampered values, the wrong key, the wrong label and plaintext', () => {
    const sealed = sealValue(key, 'c1:email', 'a@b.example');
    const body = Buffer.from(sealed.slice('enc:v1:'.length), 'base64url');
    body[14] = body[14]! ^ 1;
    const tampered = `enc:v1:${body.toString('base64url')}`;
    expect(() => openValue(key, 'c1:email', tampered)).toThrow(DecryptionError);
    expect(() => openValue(randomBytes(32), 'c1:email', sealed)).toThrow(DecryptionError);
    expect(() => openValue(key, 'c2:email', sealed)).toThrow(DecryptionError);
    expect(() => openValue(key, 'c1:phone', sealed)).toThrow(DecryptionError);
    expect(() => openValue(key, 'c1:email', 'a@b.example')).toThrow(DecryptionError);
    expect(() => openValue(key, 'c1:email', 'enc:v1:AAAA')).toThrow(DecryptionError);
  });

  it('indexes emails case- and space-insensitively, and only with the key', () => {
    const indexKey = randomBytes(32);
    expect(blindIndex(indexKey, '  A@B.example ')).toBe(blindIndex(indexKey, 'a@b.example'));
    expect(blindIndex(randomBytes(32), 'a@b.example')).not.toBe(
      blindIndex(indexKey, 'a@b.example'),
    );
    expect(blindIndex(indexKey, '  ')).toBeNull();
  });

  it('parses master key lists and rejects malformed ones', () => {
    const k = (fill: number) => Buffer.alloc(32, fill).toString('base64');
    const ring = parseKeyring(`new:${k(1)}, old:${k(2)}`);
    expect(ring.activeId).toBe('new');
    expect([...ring.keys.keys()]).toEqual(['new', 'old']);
    expect(() => parseKeyring('')).toThrow();
    expect(() => parseKeyring(`a:${Buffer.alloc(16).toString('base64')}`)).toThrow(/32 bytes/);
    expect(() => parseKeyring(`a:${k(1)},a:${k(2)}`)).toThrow(/twice/);
    expect(() => parseKeyring(`bad id:${k(1)}`)).toThrow();
  });
});

describe('customer records', () => {
  it('stores personal fields encrypted and returns them decrypted', async () => {
    const customer = await createCustomer(sales, { name: 'Harbor Cafe', ...PERSONAL });
    expect(customer).toMatchObject({ name: 'Harbor Cafe', ...PERSONAL, erasedAt: null });

    const raw = (await rawCustomer(customer.id))!;
    expect(raw.name).toBe('Harbor Cafe');
    expect(raw.code).toBe(customer.code);
    for (const field of Object.keys(PERSONAL)) {
      expect(isSealed(raw[field] as string), field).toBe(true);
    }
    expect(JSON.stringify(raw)).not.toMatch(/Dana|Whitfield|Billing|Dock|7946|morning/i);
    expect(raw.emailIndex).toBe(blindIndex(env.BLIND_INDEX_KEY, PERSONAL.email));

    const key = (await CustomerKey.findById(customer.id).lean())!;
    expect(key.kekId).toBe(env.DATA_ENCRYPTION_KEYS.activeId);
    expect(key.wrappedKey).toMatch(/^enc:v1:/);

    expect((await sales.get(`/customers/${customer.id}`)).body.data).toMatchObject(PERSONAL);
    expect((await sales.get('/customers')).body.data[0]).toMatchObject(PERSONAL);
  });

  it("can't open one customer's data with another customer's label", async () => {
    const a = await createCustomer(sales, PERSONAL);
    const b = await createCustomer(sales, {});
    const rawA = (await rawCustomer(a.id))!;
    const keys = await loadCustomerKeys([a.id, b.id]);
    expect(() => openCustomerData(b.id, keys.get(a.id)!, { email: rawA.email as string })).toThrow(
      DecryptionError,
    );
  });

  it('re-encrypts edits and keeps the email index in step', async () => {
    const customer = await createCustomer(sales, PERSONAL);
    const before = (await rawCustomer(customer.id))!;

    const res = await sales.patch(`/customers/${customer.id}`, {
      phone: '+44 20 7946 0002',
      email: 'orders@harbor.example',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      ...PERSONAL,
      phone: '+44 20 7946 0002',
      email: 'orders@harbor.example',
    });
    const after = (await rawCustomer(customer.id))!;
    expect(after.address).toBe(before.address); // untouched fields keep their ciphertext
    expect(isSealed(after.phone as string)).toBe(true);
    expect(after.emailIndex).toBe(blindIndex(env.BLIND_INDEX_KEY, 'orders@harbor.example'));

    await sales.patch(`/customers/${customer.id}`, { email: '' }).expect(200);
    const cleared = (await rawCustomer(customer.id))!;
    expect(cleared.email).toBe('');
    expect(cleared.emailIndex).toBeNull();
  });

  it('finds customers by full email, name or code, but not by partial email or contact', async () => {
    const harbor = await createCustomer(sales, { name: 'Harbor Cafe', ...PERSONAL });
    await createCustomer(sales, { name: 'Quay Bakery', email: 'hello@quay.example' });
    const found = async (search: string) =>
      (await sales.get(`/customers?search=${encodeURIComponent(search)}`)).body.data.map(
        (c: CustomerDto) => c.name,
      );

    expect(await found(' dana.whitfield@HARBOR.example ')).toEqual(['Harbor Cafe']);
    expect(await found('harbor')).toEqual(['Harbor Cafe']);
    expect(await found(harbor.code.toLowerCase())).toEqual(['Harbor Cafe']);
    expect(await found('dana.whitfield')).toEqual([]);
    expect(await found('Dana Whitfield')).toEqual([]);
  });
});

describe('addresses on orders and shipments', () => {
  it("encrypts the delivery address with the customer's key and copies it to shipments", async () => {
    const customer = await createCustomer(sales, PERSONAL);
    const so = await order(customer);
    expect(so.shippingAddress).toBe(PERSONAL.shippingAddress);
    expect(so.customerErased).toBe(false);
    const storedOrder = (await rawOrder(so.id))!;
    expect(isSealed(storedOrder.shippingAddress as string)).toBe(true);

    const custom = await sales.post('/sales-orders', {
      customerId: customer.id,
      warehouseId: warehouse.id,
      shippingAddress: 'Unit 4, Quay Side',
      lines: [{ productId: widget.id, quantity: 1 }],
    });
    expect(custom.body.data.shippingAddress).toBe('Unit 4, Quay Side');

    const shipment = await deliverAll(so);
    const storedShipment = (await rawShipment(shipment.id))!;
    expect(storedShipment.shippingAddress).toBe(storedOrder.shippingAddress);
    const read = (await admin.get(`/shipments/${shipment.id}`)).body.data as ShipmentDto;
    expect(read).toMatchObject({
      shippingAddress: PERSONAL.shippingAddress,
      customerErased: false,
    });
  });
});

describe('erasure', () => {
  it('is limited to admins and needs the customer code typed to confirm', async () => {
    const customer = await createCustomer(sales, PERSONAL);
    await erase(customer, sales).expect(403);
    await erase(customer, staff).expect(403);

    const wrong = await erase(customer, admin, 'CUS-9999');
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details).toEqual([
      { path: 'confirmCode', message: `Type ${customer.code} to confirm` },
    ]);
    const noReason = await admin.post(`/customers/${customer.id}/erase`, {
      reason: ' ',
      confirmCode: customer.code,
    });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.details[0].path).toBe('reason');

    await admin
      .post(`/customers/${new Types.ObjectId().toString()}/erase`, {
        reason: 'x',
        confirmCode: 'CUS-0001',
      })
      .expect(404);
    expect((await rawCustomer(customer.id))!.erasedAt).toBeNull();
  });

  it('is refused while orders, shipments or returns still need the address', async () => {
    const customer = await createCustomer(sales, PERSONAL);
    const so = await order(customer);
    const open = await erase(customer);
    expect(open.status).toBe(409);
    expect(open.body.error.message).toMatch(/1 open sales order/);

    const created = await staff.post('/shipments', {
      salesOrderId: so.id,
      lines: so.lines.map((l) => ({ soLineId: l.id, quantity: l.quantity })),
    });
    expect(created.status).toBe(201);
    expect((await erase(customer)).body.error.message).toMatch(/undelivered shipment/);

    await sales.post(`/sales-orders/${so.id}/cancel`, { reason: 'Customer left' }).expect(200);
    await erase(customer).expect(200);
  });

  it('destroys the key so every copy is unreadable, and keeps the history', async () => {
    const customer = await createCustomer(sales, { name: 'Harbor Cafe', ...PERSONAL });
    const so = await order(customer);
    const shipment = await deliverAll(so);
    const draft = await order(customer, false);

    const res = await erase(customer);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'Harbor Cafe',
      code: customer.code,
      contactName: '',
      email: '',
      phone: '',
      address: '',
      shippingAddress: '',
      notes: '',
      isActive: false,
    });
    expect(res.body.data.erasedAt).toEqual(expect.any(String));

    const key = (await CustomerKey.findById(customer.id).lean())!;
    expect(key).toMatchObject({ kekId: null, wrappedKey: null, shredReason: expect.any(String) });
    expect(key.shreddedBy?.name).toEqual(expect.any(String));
    const raw = (await rawCustomer(customer.id))!;
    expect(raw).toMatchObject({ email: '', emailIndex: null, erasureReason: expect.any(String) });

    // The ciphertext on the delivered order and shipment is still there, but nothing can open it.
    expect(isSealed((await rawOrder(so.id))!.shippingAddress as string)).toBe(true);
    const readOrder = (await admin.get(`/sales-orders/${so.id}`)).body.data as SalesOrderDto;
    expect(readOrder).toMatchObject({
      status: 'delivered',
      customer: expect.objectContaining({ name: 'Harbor Cafe' }),
      shippingAddress: '',
      customerErased: true,
    });
    const readShipment = (await admin.get(`/shipments/${shipment.id}`)).body.data as ShipmentDto;
    expect(readShipment).toMatchObject({ shippingAddress: '', customerErased: true });
    expect((await admin.get('/shipments')).body.data[0].customerErased).toBe(true);

    // Drafts lose their address and can't go ahead.
    expect((await rawOrder(draft.id))!.shippingAddress).toBe('');
    const confirm = await sales.post(`/sales-orders/${draft.id}/confirm`, {});
    expect(confirm.status).toBe(400);
    expect(confirm.body.error.details[0].path).toBe('customerId');

    // Not searchable by email, not editable, not erasable twice.
    const search = await sales.get(`/customers?search=${encodeURIComponent(PERSONAL.email)}`);
    expect(search.body.data).toEqual([]);
    await sales.patch(`/customers/${customer.id}`, { email: 'new@x.example' }).expect(409);
    await sales.patch(`/customers/${customer.id}`, { isActive: true }).expect(409);
    await erase(customer).expect(409);
    const neworder = await sales.post('/sales-orders', {
      customerId: customer.id,
      warehouseId: warehouse.id,
      lines: [{ productId: widget.id, quantity: 1 }],
    });
    expect(neworder.status).toBe(400);
  });

  it('succeeds exactly once under concurrent requests', async () => {
    const customer = await createCustomer(sales, PERSONAL);
    const results = await Promise.all(Array.from({ length: 5 }, () => erase(customer)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);
  });

  it('is recorded in the audit log', async () => {
    const customer = await createCustomer(sales, PERSONAL);
    await erase(customer).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const audit = await admin.get(`/audit-logs?entityId=${customer.id}`);
    expect(audit.status, JSON.stringify(audit.body)).toBe(200);
    expect(audit.body.data.map((e: { path: string }) => e.path)).toContain(
      `/customers/${customer.id}/erase`,
    );
  });
});

describe('master key rotation', () => {
  const next = randomBytes(32);
  const rotated: Keyring = {
    activeId: 'k2',
    keys: new Map([['k2', next], ...env.DATA_ENCRYPTION_KEYS.keys]),
  };

  it('re-wraps live data keys under the new master key and skips shredded ones', async () => {
    const a = await createCustomer(sales, PERSONAL);
    const b = await createCustomer(sales, { email: 'b@x.example' });
    const gone = await createCustomer(sales, PERSONAL);
    await erase(gone).expect(200);
    const before = await loadCustomerKeys([a.id, b.id]);

    expect(await rewrapCustomerKeys(rotated)).toEqual({ rewrapped: 2, remaining: 0 });
    expect(await rewrapCustomerKeys(rotated)).toEqual({ rewrapped: 0, remaining: 0 });
    expect((await CustomerKey.findById(a.id).lean())!.kekId).toBe('k2');
    expect((await CustomerKey.findById(gone.id).lean())!.wrappedKey).toBeNull();

    // The data keys themselves are unchanged, and only the new master key is needed now.
    const newOnly: Keyring = { activeId: 'k2', keys: new Map([['k2', next]]) };
    const after = await loadCustomerKeys([a.id, b.id], undefined, newOnly);
    expect(after.get(a.id)!.equals(before.get(a.id)!)).toBe(true);
    expect(after.get(b.id)!.equals(before.get(b.id)!)).toBe(true);
    await expect(loadCustomerKeys([a.id])).rejects.toThrow(/not in DATA_ENCRYPTION_KEYS/);
  });
});

describe('encrypting existing data', () => {
  it('encrypts plaintext customers and addresses, and is safe to rerun', async () => {
    const customer = await createCustomer(sales, PERSONAL);
    const so = await order(customer);
    const shipment = await deliverAll(so);
    // Turn them back into records written before encryption existed.
    const id = new Types.ObjectId(customer.id);
    await CustomerKey.deleteOne({ _id: id });
    await customers.Model.collection.updateOne(
      { _id: id },
      { $set: PERSONAL, $unset: { emailIndex: '' } },
    );
    await SalesOrder.collection.updateOne(
      { _id: new Types.ObjectId(so.id) },
      { $set: { shippingAddress: PERSONAL.shippingAddress } },
    );
    await Shipment.collection.updateOne(
      { _id: new Types.ObjectId(shipment.id) },
      { $set: { shippingAddress: PERSONAL.shippingAddress } },
    );
    const other = await createCustomer(sales, { email: 'other@x.example' });
    const otherBefore = await rawCustomer(other.id);

    expect(await encryptExistingCustomerData()).toEqual({
      keysCreated: 1,
      customers: 1,
      salesOrders: 1,
      shipments: 1,
    });
    expect(await encryptExistingCustomerData()).toEqual({
      keysCreated: 0,
      customers: 0,
      salesOrders: 0,
      shipments: 0,
    });

    const raw = (await rawCustomer(customer.id))!;
    for (const field of Object.keys(PERSONAL)) {
      expect(isSealed(raw[field] as string), field).toBe(true);
    }
    expect(raw.emailIndex).toBe(blindIndex(env.BLIND_INDEX_KEY, PERSONAL.email));
    expect(await rawCustomer(other.id)).toEqual(otherBefore);
    expect((await sales.get(`/customers/${customer.id}`)).body.data).toMatchObject(PERSONAL);
    expect((await admin.get(`/sales-orders/${so.id}`)).body.data.shippingAddress).toBe(
      PERSONAL.shippingAddress,
    );
    expect((await admin.get(`/shipments/${shipment.id}`)).body.data.shippingAddress).toBe(
      PERSONAL.shippingAddress,
    );
  });
});
