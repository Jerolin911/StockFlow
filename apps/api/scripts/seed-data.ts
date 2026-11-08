import mongoose from 'mongoose';
import {
  createCustomerSchema,
  createProductSchema,
  createSupplierSchema,
  openingStockSchema,
  stockAdjustmentSchema,
  type Role,
  type Unit,
} from '@stockflow/shared';
import { hashPassword } from '../src/modules/auth/passwords.js';
import { Category } from '../src/modules/categories/categories.js';
import { customers, suppliers } from '../src/modules/partners/partners.js';
import { createProduct } from '../src/modules/products/products.js';
import { postAdjustment, registerOpeningStock } from '../src/modules/stock/adjustments.service.js';
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

  for (const supplier of SUPPLIERS) await suppliers.create(createSupplierSchema.parse(supplier));
  for (const customer of CUSTOMERS) await customers.create(createCustomerSchema.parse(customer));
}
