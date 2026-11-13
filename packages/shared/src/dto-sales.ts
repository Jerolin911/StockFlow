import type { ProductRef, UserRef, WarehouseRef } from './dto.js';
import type { HistoryEntryDto, PartnerRef } from './dto-procurement.js';
import type { SalesOrderStatus, ShipmentStatus, TrackingEventType } from './schemas/sales.js';

export interface SalesOrderLineDto {
  id: string;
  productId: string;
  sku: string;
  name: string;
  unit: ProductRef['unit'];
  quantity: number;
  /** On shipments that haven't been dispatched yet. */
  allocatedQuantity: number;
  shippedQuantity: number;
  deliveredQuantity: number;
  /** Released without shipping when the order or its remainder was cancelled. */
  cancelledQuantity: number;
  /** On customer returns (requested, or received once back). */
  returnedQuantity: number;
  /** Held against stock: quantity − shipped − cancelled while the order is open. */
  reservedQuantity: number;
  /** Not yet on any shipment: quantity − allocated − shipped − cancelled. */
  unallocatedQuantity: number;
  unitPrice: number;
  discountRate: number;
  taxRate: number;
  lineGross: number;
  lineDiscount: number;
  lineSubtotal: number;
  lineTax: number;
  lineTotal: number;
}

export interface SalesOrderDto {
  id: string;
  number: string;
  status: SalesOrderStatus;
  customer: PartnerRef;
  warehouse: WarehouseRef;
  orderDate: string;
  requiredDate: string | null;
  shippingAddress: string;
  /** The customer's personal data was erased, so the shipping address can no longer be read. */
  customerErased: boolean;
  customerReference: string;
  notes: string;
  lines: SalesOrderLineDto[];
  grossTotal: number;
  discountTotal: number;
  subtotal: number;
  taxTotal: number;
  total: number;
  createdBy: UserRef;
  confirmedBy: UserRef | null;
  confirmedAt: string | null;
  cancelReason: string;
  shipmentCount: number;
  isOverdue: boolean;
  history: HistoryEntryDto[];
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseAvailabilityDto {
  warehouse: WarehouseRef & { isActive: boolean };
  onHand: number;
  reserved: number;
  available: number;
  quarantine: number;
}

export interface ProductAvailabilityDto {
  productId: string;
  warehouses: WarehouseAvailabilityDto[];
}

export interface ShipmentLineDto {
  id: string;
  soLineId: string;
  productId: string;
  sku: string;
  name: string;
  unit: ProductRef['unit'];
  /** Requested on the pick list. */
  quantity: number;
  /** Set when picking is confirmed; this is what's packed and dispatched. */
  pickedQuantity: number | null;
  /** Average cost at dispatch. */
  unitCost: number | null;
}

export interface TrackingEventDto {
  type: TrackingEventType | 'dispatched';
  at: string;
  location: string;
  note: string;
  by: UserRef;
}

export interface ShipmentDto {
  id: string;
  number: string;
  status: ShipmentStatus;
  salesOrder: { id: string; number: string };
  customer: PartnerRef;
  warehouse: WarehouseRef;
  shippingAddress: string;
  /** The customer's personal data was erased, so the shipping address can no longer be read. */
  customerErased: boolean;
  lines: ShipmentLineDto[];
  totals: { requested: number; picked: number | null };
  notes: string;
  shortPickReason: string;
  packageCount: number | null;
  weightGrams: number | null;
  carrier: string;
  trackingNumber: string;
  receivedBy: string;
  cancelReason: string;
  pickedAt: string | null;
  pickedBy: UserRef | null;
  packedAt: string | null;
  packedBy: UserRef | null;
  dispatchedAt: string | null;
  dispatchedBy: UserRef | null;
  deliveredAt: string | null;
  tracking: TrackingEventDto[];
  history: HistoryEntryDto[];
  createdBy: UserRef;
  createdAt: string;
  updatedAt: string;
}

export interface FulfilmentSummaryDto {
  ordersToConfirm: number;
  ordersToFulfil: number;
  shipmentsToPick: number;
  shipmentsToPack: number;
  shipmentsToDispatch: number;
  shipmentsInTransit: number;
}
