import mongoose from 'mongoose';
import {
  createCustomerSchema,
  createProductSchema,
  createSupplierSchema,
  confirmPickSchema,
  createShipmentSchema,
  createStockCountSchema,
  customerReturnSchema,
  dispatchTransferSchema,
  quarantineActionSchema,
  receiveCustomerReturnSchema,
  receiveTransferSchema,
  supplierReturnSchema,
  transferSchema,
  dispatchShipmentSchema,
  goodsReceiptSchema,
  openingStockSchema,
  packShipmentSchema,
  purchaseOrderSchema,
  salesOrderSchema,
  trackingEventSchema,
  stockAdjustmentSchema,
  type Role,
  type Unit,
} from '@stockflow/shared';
import { hashPassword } from '../src/modules/auth/passwords.js';
import { Category } from '../src/modules/categories/categories.js';
import { customers, suppliers } from '../src/modules/partners/partners.js';
import { nextDocumentNumber } from '../src/lib/counters.js';
import { Product } from '../src/modules/products/product.model.js';
import { createProduct } from '../src/modules/products/products.js';
import {
  dateFromIso,
  historyEntry,
  snapshot,
  type Actor,
} from '../src/modules/common/documents.js';
import { postGoodsReceipt } from '../src/modules/purchasing/goods-receipts.js';
import { PurchaseOrder, PurchaseRequest, SupplierPrice } from '../src/modules/purchasing/models.js';
import { createPurchaseOrder } from '../src/modules/purchasing/purchase-orders.js';
import { SalesOrder, Shipment } from '../src/modules/sales/models.js';
import {
  cancelSalesOrder,
  confirmSalesOrder,
  createSalesOrder,
} from '../src/modules/sales/sales-orders.js';
import {
  addTrackingEvent,
  confirmPick,
  createShipment,
  dispatch,
  pack,
} from '../src/modules/sales/shipments.js';
import {
  createCustomerReturn,
  receiveCustomerReturn,
} from '../src/modules/returns/customer-returns.js';
import { CustomerReturn, SupplierReturn } from '../src/modules/returns/models.js';
import { createSupplierReturn } from '../src/modules/returns/supplier-returns.js';
import { postAdjustment, registerOpeningStock } from '../src/modules/stock/adjustments.service.js';
import { postQuarantineAction } from '../src/modules/stock/quarantine.service.js';
import { StockCount, StockTransfer } from '../src/modules/warehouse-ops/models.js';
import { createStockCount } from '../src/modules/warehouse-ops/stock-counts.js';
import {
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
} from '../src/modules/warehouse-ops/transfers.js';
import { User } from '../src/modules/users/user.model.js';
import { Warehouse } from '../src/modules/warehouses/warehouse.model.js';

/** Demo-only credentials. Every seeded account uses this password unless SEED_PASSWORD is set. */
export const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'StockFlow-Demo-2026';

export const DEMO_USERS: { name: string; email: string; role: Role }[] = [
  { name: 'Dana Whitfield', email: 'admin@stockflow.test', role: 'admin' },
  { name: 'Marcus Chen', email: 'inventory@stockflow.test', role: 'inventory_manager' },
  { name: 'Priya Nair', email: 'procurement@stockflow.test', role: 'procurement_manager' },
  { name: 'Lucas Romero', email: 'sales@stockflow.test', role: 'sales_manager' },
  { name: 'Amara Okafor', email: 'staff@stockflow.test', role: 'staff' },
];

const WAREHOUSES = [
  { code: 'MAIN', name: 'Central Warehouse', address: '14 Harbour Road, Unit 3' },
  { code: 'NORTH', name: 'North Depot', address: '220 Mill Lane' },
  { code: 'STORE', name: 'City Store Room', address: '5 Market Street (rear)' },
];

const CATEGORIES = [
  { code: 'OFF', name: 'Office Supplies', description: 'Paper, writing and desk items' },
  { code: 'ELC', name: 'Electronics', description: 'Peripherals, cables and accessories' },
  { code: 'FUR', name: 'Furniture', description: 'Desks, chairs and storage' },
  { code: 'PKG', name: 'Packaging', description: 'Boxes, tape and protective materials' },
  { code: 'CLN', name: 'Cleaning', description: 'Cleaning products and hygiene supplies' },
];

// [category, name, unit, cost (minor), price (minor), reorder point, reorder qty, MAIN, NORTH]
type ProductSeed = [string, string, Unit, number, number, number, number, number, number];
const PRODUCTS: ProductSeed[] = [
  ['OFF', 'A4 Copy Paper 80gsm (500 sheets)', 'pack', 320, 549, 40, 200, 180, 60],
  ['OFF', 'Ballpoint Pen, Blue (box of 50)', 'box', 650, 1199, 10, 40, 34, 18],
  ['OFF', 'Lever Arch File A4', 'pcs', 145, 299, 30, 100, 22, 45],
  ['OFF', 'Sticky Notes 76×76mm (12 pads)', 'pack', 380, 699, 15, 60, 48, 20],
  ['OFF', 'Desk Stapler, Full Strip', 'pcs', 540, 1099, 8, 24, 12, 10],
  ['ELC', 'USB-C to HDMI Adapter', 'pcs', 1150, 2499, 10, 30, 16, 0],
  ['ELC', 'Wireless Mouse', 'pcs', 890, 1899, 12, 40, 38, 15],
  ['ELC', 'Mechanical Keyboard, UK Layout', 'pcs', 3600, 6999, 5, 15, 6, 6],
  ['ELC', '27" IPS Monitor', 'pcs', 13800, 21999, 3, 10, 9, 2],
  ['ELC', 'Cat6 Patch Cable 2m', 'pcs', 160, 449, 50, 200, 240, 80],
  ['FUR', 'Ergonomic Office Chair', 'pcs', 9800, 18999, 4, 10, 7, 5],
  ['FUR', 'Height-Adjustable Desk 140cm', 'pcs', 21500, 37999, 2, 6, 3, 3],
  ['FUR', '4-Drawer Filing Cabinet', 'pcs', 11200, 19999, 2, 5, 2, 0],
  ['PKG', 'Double-Wall Carton 45×35×30cm', 'pcs', 95, 189, 150, 500, 420, 160],
  ['PKG', 'Packing Tape 48mm × 66m', 'roll', 85, 199, 60, 240, 55, 70],
  ['PKG', 'Bubble Wrap Roll 500mm × 50m', 'roll', 1250, 2199, 6, 20, 14, 8],
  ['CLN', 'Multi-Surface Cleaner 750ml', 'bottle', 210, 399, 24, 96, 30, 26],
  ['CLN', 'Nitrile Gloves, Medium (box of 100)', 'box', 520, 899, 10, 40, 9, 12],
  ['CLN', 'Paper Towel Rolls (pack of 6)', 'pack', 430, 749, 20, 60, 44, 26],
];

const SUPPLIERS = [
  {
    name: 'Brightline Office Wholesale',
    contactName: 'Helen Marsh',
    email: 'orders@brightline.test',
    phone: '+44 113 496 0123',
    leadTimeDays: 3,
  },
  {
    name: 'Volt Distribution Ltd',
    contactName: 'Sam Patel',
    email: 'trade@voltdist.test',
    phone: '+44 161 496 0456',
    leadTimeDays: 5,
  },
  {
    name: 'Oakridge Furniture Co.',
    contactName: 'Grace Lin',
    email: 'sales@oakridge.test',
    phone: '+44 121 496 0789',
    leadTimeDays: 14,
  },
  {
    name: 'PackRight Supplies',
    contactName: 'Tom Walsh',
    email: 'hello@packright.test',
    phone: '+44 117 496 0321',
    leadTimeDays: 4,
  },
];

const CUSTOMERS = [
  {
    name: 'Harbour View Dental',
    contactName: 'Dr. Aisha Khan',
    email: 'admin@harbourdental.test',
    address: '3 Quay Street',
    shippingAddress: '3 Quay Street',
  },
  {
    name: 'Greenfield Primary School',
    contactName: 'Mark Ellis',
    email: 'office@greenfield.test',
    address: 'School Lane',
    shippingAddress: 'Deliveries: Gate B, School Lane',
  },
  {
    name: 'Northgate Architects',
    contactName: 'Sofia Rossi',
    email: 'studio@northgate.test',
    address: '41 Northgate',
    shippingAddress: '41 Northgate, 2nd floor',
  },
  {
    name: 'Bayside Coworking',
    contactName: 'Ben Carter',
    email: 'ops@baysidecowork.test',
    address: '9 Dock Road',
    shippingAddress: '9 Dock Road',
  },
  {
    name: 'Kestrel Logistics',
    contactName: 'Nina Novak',
    email: 'facilities@kestrel.test',
    address: 'Unit 12, Airport Park',
    shippingAddress: 'Unit 12, Airport Park',
  },
];

export async function seedDatabase(): Promise<void> {
  await mongoose.connection.db!.dropDatabase();
  // Model.init() is memoised and won't run again after the drop, so rebuild indexes explicitly.
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users = await User.insertMany(DEMO_USERS.map((user) => ({ ...user, passwordHash })));
  const inventoryManager = users.find((u) => u.role === 'inventory_manager')!._id.toString();

  const warehouses = await Warehouse.insertMany(WAREHOUSES);
  const warehouseId = (code: string) => warehouses.find((w) => w.code === code)!._id.toString();
  const categories = await Category.insertMany(CATEGORIES);

  const productIds: string[] = [];
  for (const [
    code,
    name,
    unit,
    costPrice,
    sellingPrice,
    reorderPoint,
    reorderQuantity,
  ] of PRODUCTS) {
    const categoryId = categories.find((c) => c.code === code)!._id.toString();
    productIds.push(
      await createProduct(
        createProductSchema.parse({
          name,
          categoryId,
          unit,
          costPrice,
          sellingPrice,
          reorderPoint,
          reorderQuantity,
        }),
      ),
    );
  }

  for (const [column, code] of [
    [7, 'MAIN'],
    [8, 'NORTH'],
  ] as const) {
    const lines = PRODUCTS.flatMap((p, i) =>
      p[column] > 0 ? [{ productId: productIds[i]!, quantity: p[column] }] : [],
    );
    await registerOpeningStock(
      openingStockSchema.parse({
        warehouseId: warehouseId(code),
        notes: 'Initial stock take',
        lines,
      }),
      inventoryManager,
    );
  }

  await postAdjustment(
    stockAdjustmentSchema.parse({
      warehouseId: warehouseId('MAIN'),
      reason: 'damage',
      notes: 'Water damage in aisle 4',
      lines: [
        { productId: productIds[0], quantityChange: -12 },
        { productId: productIds[13], quantityChange: -20 },
      ],
    }),
    inventoryManager,
  );

  const supplierIds: string[] = [];
  for (const supplier of SUPPLIERS) {
    supplierIds.push((await suppliers.create(createSupplierSchema.parse(supplier)))._id.toString());
  }
  const customerIds: string[] = [];
  for (const customer of CUSTOMERS) {
    customerIds.push((await customers.create(createCustomerSchema.parse(customer)))._id.toString());
  }

  await seedProcurement(users, supplierIds, productIds, warehouseId);
  await seedSales(users, customerIds, productIds, warehouseId);
  await seedWarehouseOps(users, supplierIds, productIds, warehouseId);
}

/**
 * Transfers (received, in transit, awaiting approval), a customer return awaiting
 * inspection, quarantined damaged stock with an approved supplier return, and a count in
 * progress, all through the real services.
 */
async function seedWarehouseOps(
  users: SeedUser[],
  supplierIds: string[],
  productIds: string[],
  warehouseId: (code: string) => string,
) {
  const actor = actorFor(users);
  const staff = actor('staff');
  const inventory = actor('inventory_manager');
  const sales = actor('sales_manager');
  const procurement = actor('procurement_manager');
  const packright = supplierIds[3]!;

  const approval = (by: Actor) => ({
    $set: { status: 'approved', approvedBy: snapshot(by), approvedAt: new Date() },
    $push: { history: historyEntry(by, 'approved') },
  });
  const transfer = (from: string, to: string, lines: [number, number][], notes = '') =>
    createTransfer(
      transferSchema.parse({
        fromWarehouseId: warehouseId(from),
        toWarehouseId: warehouseId(to),
        notes,
        lines: lines.map(([i, quantity]) => ({ productId: productIds[i], quantity })),
      }),
      staff,
    );

  // Cartons moved to the north depot and received in full.
  const cartons = await transfer('MAIN', 'NORTH', [[13, 100]], 'North depot packing line');
  await StockTransfer.updateOne({ _id: cartons }, approval(inventory));
  await dispatchTransfer(cartons, dispatchTransferSchema.parse({ carrier: 'Own van' }), staff);
  const cartonsDoc = await StockTransfer.findById(cartons).lean();
  await receiveTransfer(
    cartons,
    receiveTransferSchema.parse({
      lines: [{ lineId: cartonsDoc!.lines[0]!._id.toString(), receivedQuantity: 100 }],
    }),
    staff,
  );

  // Paper and cables on the road to the north depot.
  const onTheRoad = await transfer('MAIN', 'NORTH', [
    [0, 30],
    [9, 50],
  ]);
  await StockTransfer.updateOne({ _id: onTheRoad }, approval(inventory));
  await dispatchTransfer(
    onTheRoad,
    dispatchTransferSchema.parse({ carrier: 'Northline Freight', reference: 'NLF-40032210' }),
    staff,
  );

  // The city store asks the north depot for sticky notes.
  await transfer('NORTH', 'STORE', [[3, 10]], 'Counter display restock');

  // Two sticky-note packs from the delivered dental order came back crushed.
  const dentalOrder = await SalesOrder.findOne({
    'customer.name': 'Harbour View Dental',
    status: 'delivered',
  }).lean();
  const stickyLine = dentalOrder!.lines.find((l) => l.productId.toString() === productIds[3])!;
  const rma = await createCustomerReturn(
    customerReturnSchema.parse({
      salesOrderId: dentalOrder!._id.toString(),
      reason: 'damaged',
      notes: 'Outer box crushed in delivery',
      lines: [{ soLineId: stickyLine._id.toString(), quantity: 2 }],
    }),
    sales,
  );
  await CustomerReturn.updateOne({ _id: rma }, approval(sales));
  const rmaDoc = await CustomerReturn.findById(rma).lean();
  await receiveCustomerReturn(
    rma,
    receiveCustomerReturnSchema.parse({
      lines: [{ lineId: rmaDoc!.lines[0]!._id.toString(), receivedQuantity: 2 }],
    }),
    staff,
  );

  // Bubble wrap with water damage isolated, and a return to PackRight approved.
  await postQuarantineAction(
    quarantineActionSchema.parse({
      warehouseId: warehouseId('MAIN'),
      action: 'quarantine',
      reason: 'damage',
      notes: 'Rolls soaked by the roof leak',
      lines: [{ productId: productIds[15], quantity: 2 }],
    }),
    inventory.id,
  );
  const srn = await createSupplierReturn(
    supplierReturnSchema.parse({
      supplierId: packright,
      warehouseId: warehouseId('MAIN'),
      reason: 'damaged',
      notes: 'Water damage; PackRight agreed to replace',
      lines: [{ productId: productIds[15], quantity: 2, source: 'quarantine' }],
    }),
    inventory,
  );
  await SupplierReturn.updateOne({ _id: srn }, approval(procurement));

  // A count of office supplies at the north depot, part-way through.
  const categoryId = (await Category.findOne({ code: 'OFF' }).lean())!._id.toString();
  const countId = await createStockCount(
    createStockCountSchema.parse({ warehouseId: warehouseId('NORTH'), categoryId }),
    staff,
  );
  const count = await StockCount.findById(countId);
  count!.lines.slice(0, 3).forEach((line, index) => {
    // The first two match; the third is two short.
    line.countedQuantity = line.snapshotQuantity - (index === 2 ? 2 : 0);
  });
  await count!.save();
}

const actorFor =
  (users: SeedUser[]) =>
  (role: Role): Actor => {
    const u = users.find((user) => user.role === role)!;
    return { id: u._id.toString(), name: u.name, email: u.email, role, mustChangePassword: false };
  };

/**
 * Sales orders in each fulfilment stage, reserved, picked, packed, dispatched and delivered
 * through the real services so reservations and the ledger agree.
 */
async function seedSales(
  users: SeedUser[],
  customerIds: string[],
  productIds: string[],
  warehouseId: (code: string) => string,
) {
  const actor = actorFor(users);
  const sales = actor('sales_manager');
  const staff = actor('staff');
  const [dental, school, architects, coworking, logistics] = customerIds as [
    string,
    string,
    string,
    string,
    string,
  ];
  const inDays = (days: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const order = async (
    customerId: string,
    lines: [number, number, number?][],
    extra: Record<string, unknown> = {},
    confirm = true,
  ) => {
    const id = await createSalesOrder(
      salesOrderSchema.parse({
        customerId,
        warehouseId: warehouseId('MAIN'),
        lines: lines.map(([i, quantity, discountRate]) => ({
          productId: productIds[i],
          quantity,
          ...(discountRate ? { discountRate } : {}),
        })),
        ...extra,
      }),
      sales,
    );
    if (confirm) await confirmSalesOrder(id, sales);
    return id;
  };

  /** Creates a pick list for the given product quantities and returns its id. */
  const pickList = async (salesOrderId: string, lines: [number, number][]) => {
    const so = await SalesOrder.findById(salesOrderId).lean();
    return createShipment(
      createShipmentSchema.parse({
        salesOrderId,
        lines: lines.map(([i, quantity]) => ({
          soLineId: so!.lines.find((l) => l.productId.toString() === productIds[i])!._id.toString(),
          quantity,
        })),
      }),
      staff,
    );
  };
  const pickAll = async (shipmentId: string) => {
    const shipment = await Shipment.findById(shipmentId).lean();
    await confirmPick(
      shipmentId,
      confirmPickSchema.parse({
        lines: shipment!.lines.map((l) => ({
          lineId: l._id.toString(),
          pickedQuantity: l.quantity,
        })),
      }),
      staff,
    );
  };
  const packed = (shipmentId: string, packageCount: number, weightGrams: number) =>
    pack(shipmentId, packShipmentSchema.parse({ packageCount, weightGrams }), staff);
  const dispatched = (shipmentId: string, carrier: string, trackingNumber = '') =>
    dispatch(shipmentId, dispatchShipmentSchema.parse({ carrier, trackingNumber }), staff);
  const track = (shipmentId: string, event: Record<string, unknown>) =>
    addTrackingEvent(shipmentId, trackingEventSchema.parse(event), staff);

  // Delivered in full.
  const dentalOrder = await order(dental, [
    [0, 20],
    [3, 2],
  ]);
  const dentalShipment = await pickList(dentalOrder, [
    [0, 20],
    [3, 2],
  ]);
  await pickAll(dentalShipment);
  await packed(dentalShipment, 2, 9800);
  await dispatched(dentalShipment, 'Own van');
  await track(dentalShipment, { type: 'delivered', receivedBy: 'Reception' });

  // Half the paper shipped and on the way; the rest and the pens still reserved.
  const schoolOrder = await order(
    school,
    [
      [0, 40, 500],
      [1, 10, 500],
    ],
    { customerReference: 'GPS-PO-2231', requiredDate: inDays(5) },
  );
  const schoolShipment = await pickList(schoolOrder, [[0, 20]]);
  await pickAll(schoolShipment);
  await packed(schoolShipment, 4, 25000);
  await dispatched(schoolShipment, 'Northline Freight', 'NLF-40031877');
  await track(schoolShipment, { type: 'in_transit', location: 'Riverside hub' });

  // Being picked.
  const architectsOrder = await order(
    architects,
    [
      [10, 2],
      [8, 1],
    ],
    { requiredDate: inDays(3) },
  );
  await pickList(architectsOrder, [
    [10, 2],
    [8, 1],
  ]);

  // Packed and waiting for the carrier.
  const logisticsOrder = await order(logistics, [
    [13, 30],
    [15, 5],
  ]);
  const logisticsShipment = await pickList(logisticsOrder, [
    [13, 30],
    [15, 5],
  ]);
  await pickAll(logisticsShipment);
  await packed(logisticsShipment, 3, 14200);

  // Confirmed and waiting for a pick list.
  await order(
    coworking,
    [
      [6, 6],
      [9, 10],
    ],
    { requiredDate: inDays(2) },
  );

  // Draft quote for keyboards; would take MAIN below its reorder point.
  await order(coworking, [[7, 4, 1000]], { notes: 'Quote for the new hot-desk area' }, false);

  // Cancelled before anything was picked.
  const cancelled = await order(dental, [[11, 1]]);
  await cancelSalesOrder(cancelled, 'Customer chose a different desk model', sales);
}

type SeedUser = { _id: mongoose.Types.ObjectId; name: string; email: string; role: Role };

/** Supplier prices, a pending request and purchase orders in each stage, received via the real services. */
async function seedProcurement(
  users: SeedUser[],
  supplierIds: string[],
  productIds: string[],
  warehouseId: (code: string) => string,
) {
  const actor = actorFor(users);
  const procurement = actor('procurement_manager');
  const admin = actor('admin');
  const staff = actor('staff');
  const [brightline, volt, oakridge, packright] = supplierIds as [string, string, string, string];

  // Supplier prices at roughly 5% below list cost, by the supplier's speciality.
  const ranges: [string, number[]][] = [
    [brightline, [0, 1, 2, 3, 4]],
    [volt, [5, 6, 7, 8, 9]],
    [oakridge, [10, 11, 12]],
    [packright, [13, 14, 15, 16, 17, 18]],
  ];
  for (const [supplierId, indexes] of ranges) {
    for (const i of indexes) {
      const [, , , cost] = PRODUCTS[i]!;
      await SupplierPrice.create({
        supplierId,
        productId: productIds[i],
        unitCost: Math.round(cost * 0.95),
        supplierSku: `S-${String(i + 1).padStart(3, '0')}`,
      });
    }
  }

  const approve = (id: string) =>
    PurchaseOrder.updateOne(
      { _id: id },
      {
        $set: { status: 'approved', approvedBy: snapshot(admin), approvedAt: new Date() },
        $push: {
          history: {
            $each: [historyEntry(procurement, 'submitted'), historyEntry(admin, 'approved')],
          },
        },
      },
    );
  const order = (supplierId: string, expectedDate: string | null, lines: [number, number][]) =>
    createPurchaseOrder(
      purchaseOrderSchema.parse({
        supplierId,
        warehouseId: warehouseId('MAIN'),
        expectedDate,
        lines: lines.map(([i, quantity]) => ({ productId: productIds[i], quantity })),
      }),
      procurement,
    );
  const lineId = async (poId: string, productIndex: number) => {
    const po = await PurchaseOrder.findById(poId).lean();
    return po!.lines
      .find((l) => l.productId.toString() === productIds[productIndex])!
      ._id.toString();
  };
  const inDays = (days: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  // Fully received, on time.
  const chairs = await order(oakridge, inDays(10), [[10, 4]]);
  await approve(chairs);
  await postGoodsReceipt(
    goodsReceiptSchema.parse({
      purchaseOrderId: chairs,
      deliveryNote: 'OAK-55120',
      lines: [{ poLineId: await lineId(chairs, 10), acceptedQuantity: 4 }],
    }),
    staff,
  );

  // Partially received with damaged goods; keyboards still outstanding.
  const electronics = await order(volt, inDays(3), [
    [5, 20],
    [7, 10],
  ]);
  await approve(electronics);
  await postGoodsReceipt(
    goodsReceiptSchema.parse({
      purchaseOrderId: electronics,
      deliveryNote: 'VD-88231',
      lines: [
        {
          poLineId: await lineId(electronics, 5),
          acceptedQuantity: 12,
          damagedQuantity: 3,
          rejectionReason: 'Crushed outer cartons',
        },
      ],
    }),
    staff,
  );

  // Approved but past its expected date.
  const tape = await order(packright, inDays(-2), [[14, 240]]);
  await approve(tape);

  // Awaiting approval.
  const files = await order(brightline, inDays(4), [
    [2, 100],
    [1, 20],
  ]);
  await PurchaseOrder.updateOne(
    { _id: files },
    {
      $set: { status: 'pending_approval' },
      $push: { history: historyEntry(procurement, 'submitted') },
    },
  );

  // A request from the warehouse floor waiting for approval.
  const requested = await Product.find(
    { _id: { $in: [productIds[17], productIds[18]] } },
    { sku: 1, name: 1, unit: 1 },
  ).lean();
  await PurchaseRequest.create({
    number: await nextDocumentNumber('PR'),
    status: 'submitted',
    warehouseId: warehouseId('MAIN'),
    neededBy: dateFromIso(inDays(7)),
    notes: 'Gloves running out on the packing line',
    lines: requested.map((p) => ({
      productId: p._id,
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      quantity: p._id.toString() === productIds[17] ? 40 : 20,
    })),
    requestedBy: snapshot(staff),
    history: [historyEntry(staff, 'created'), historyEntry(staff, 'submitted')],
  });
}
