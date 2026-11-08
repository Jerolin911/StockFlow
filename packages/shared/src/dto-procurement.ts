import type { ProductRef, UserRef, WarehouseRef } from './dto.js';
import type { PurchaseOrderStatus, PurchaseRequestStatus } from './schemas/procurement.js';

export interface PartnerRef {
  id: string;
  code: string;
  name: string;
}

export interface HistoryEntryDto {
  action: string;
  at: string;
  by: UserRef;
  note: string;
}

export interface SupplierPriceDto {
  product: ProductRef & { costPrice: number; isActive: boolean };
  unitCost: number;
  supplierSku: string;
  updatedAt: string;
}

export interface ProductSupplierPriceDto extends SupplierPriceDto {
  supplier: PartnerRef & { isActive: boolean };
}

export interface PurchaseRequestLineDto {
  id: string;
  productId: string;
  sku: string;
  name: string;
  unit: ProductRef['unit'];
  quantity: number;
  note: string;
}

export interface PurchaseRequestDto {
  id: string;
  number: string;
  status: PurchaseRequestStatus;
  warehouse: WarehouseRef;
  supplier: PartnerRef | null;
  neededBy: string | null;
  notes: string;
  lines: PurchaseRequestLineDto[];
  requestedBy: UserRef;
  purchaseOrder: { id: string; number: string } | null;
  rejectionReason: string;
  history: HistoryEntryDto[];
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderLineDto {
  id: string;
  productId: string;
  sku: string;
  name: string;
  unit: ProductRef['unit'];
  quantity: number;
  /** Accepted into stock. */
  receivedQuantity: number;
  rejectedQuantity: number;
  damagedQuantity: number;
  /** Still expected: quantity − received, or 0 once the order is closed or cancelled. */
  pendingQuantity: number;
  unitCost: number;
  taxRate: number;
  lineSubtotal: number;
  lineTax: number;
  lineTotal: number;
}

export interface PurchaseOrderDto {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  supplier: PartnerRef;
  warehouse: WarehouseRef;
  purchaseRequest: { id: string; number: string } | null;
  orderDate: string;
  expectedDate: string | null;
  notes: string;
  lines: PurchaseOrderLineDto[];
  subtotal: number;
  taxTotal: number;
  total: number;
  createdBy: UserRef;
  approvedBy: UserRef | null;
  approvedAt: string | null;
  rejectionReason: string;
  cancelReason: string;
  closeReason: string;
  receiptCount: number;
  isOverdue: boolean;
  history: HistoryEntryDto[];
  createdAt: string;
  updatedAt: string;
}

export interface GoodsReceiptLineDto {
  poLineId: string;
  productId: string;
  sku: string;
  name: string;
  unit: ProductRef['unit'];
  acceptedQuantity: number;
  rejectedQuantity: number;
  damagedQuantity: number;
  rejectionReason: string;
  unitCost: number;
}

export interface GoodsReceiptDto {
  id: string;
  number: string;
  purchaseOrder: { id: string; number: string };
  supplier: PartnerRef;
  warehouse: WarehouseRef;
  receivedAt: string;
  deliveryNote: string;
  notes: string;
  lines: GoodsReceiptLineDto[];
  totals: { accepted: number; rejected: number; damaged: number };
  onTime: boolean | null;
  createdBy: UserRef;
  createdAt: string;
}

export interface SupplierDeliverySummaryDto {
  receipts: number;
  onTime: number;
  late: number;
  acceptedUnits: number;
  rejectedUnits: number;
  damagedUnits: number;
  openOrders: number;
  overdueOrders: number;
}
