import type { Currency } from './money.js';
import type { Unit } from './schemas/master-data.js';
import type { AdjustmentReason, MovementType, StockDocumentType } from './schemas/stock.js';

export interface SettingsDto {
  companyName: string;
  currency: Currency;
}

export interface WarehouseRef {
  id: string;
  code: string;
  name: string;
}

export interface WarehouseDto extends WarehouseRef {
  address: string;
  isActive: boolean;
  stock: { skuCount: number; onHand: number };
  createdAt: string;
  updatedAt: string;
}

export interface CategoryDto {
  id: string;
  name: string;
  code: string;
  description: string;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductStockSummary {
  onHand: number;
  reserved: number;
  available: number;
  /** Warehouses holding the product where available ≤ threshold. */
  lowStockWarehouses: number;
  stockedWarehouses: number;
}

export interface ProductDto {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: { id: string; name: string; code: string } | null;
  unit: Unit;
  barcode: string;
  costPrice: number;
  sellingPrice: number;
  taxRate: number;
  avgCost: number;
  reorderPoint: number;
  reorderQuantity: number;
  isActive: boolean;
  stock: ProductStockSummary;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerDto {
  id: string;
  code: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierDto extends PartnerDto {
  leadTimeDays: number | null;
}

export interface CustomerDto extends PartnerDto {
  shippingAddress: string;
}

export interface ProductRef {
  id: string;
  sku: string;
  name: string;
  unit: Unit;
}

export interface StockLevelDto {
  id: string;
  product: ProductRef & { categoryName: string | null; isActive: boolean };
  warehouse: WarehouseRef;
  onHand: number;
  reserved: number;
  available: number;
  /** Threshold in effect: the warehouse override, else the product default. */
  reorderPoint: number;
  reorderPointOverride: number | null;
  isLow: boolean;
  updatedAt: string;
}

export interface UserRef {
  id: string;
  name: string;
}

export interface StockMovementDto {
  id: string;
  type: MovementType;
  quantity: number;
  balanceAfter: number;
  unitCost: number;
  product: ProductRef;
  warehouse: WarehouseRef;
  reference: { type: StockDocumentType; id: string; number: string };
  createdBy: UserRef;
  createdAt: string;
}

export interface StockAdjustmentLineDto {
  productId: string;
  sku: string;
  name: string;
  unit: Unit;
  quantityChange: number;
  previousOnHand: number;
  balanceAfter: number;
  unitCost: number;
}

export interface StockAdjustmentDto {
  id: string;
  number: string;
  type: StockDocumentType;
  warehouse: WarehouseRef;
  reason: AdjustmentReason | null;
  notes: string;
  lines: StockAdjustmentLineDto[];
  totalIn: number;
  totalOut: number;
  createdBy: UserRef;
  createdAt: string;
}
