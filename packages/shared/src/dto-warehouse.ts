import type { ProductRef, UserRef, WarehouseRef } from './dto.js';
import type { HistoryEntryDto, PartnerRef } from './dto-procurement.js';
import type {
  CustomerReturnStatus,
  ReturnReason,
  SupplierReturnStatus,
} from './schemas/returns.js';
import type { StockBucket } from './schemas/stock.js';
import type { StockCountStatus, TransferStatus, VarianceReason } from './schemas/warehouse-ops.js';

type DocRef = { id: string; number: string };

export interface TransferLineDto {
  id: string;
  productId: string;
  sku: string;
  name: string;
  unit: ProductRef['unit'];
  quantity: number;
  dispatchedQuantity: number;
  receivedQuantity: number;
  /** Arrived damaged; received into the destination's quarantine. */
  damagedQuantity: number;
  /** Never arrived; written off when the transfer was closed short. */
  lostQuantity: number;
  /** Dispatched and not yet accounted for at the destination. */
  inTransitQuantity: number;
  unitCost: number | null;
}

export interface TransferReceiptDto {
  at: string;
  by: UserRef;
  note: string;
  lines: { lineId: string; receivedQuantity: number; damagedQuantity: number }[];
}

export interface TransferDto {
  id: string;
  number: string;
  status: TransferStatus;
  fromWarehouse: WarehouseRef;
  toWarehouse: WarehouseRef;
  neededBy: string | null;
  notes: string;
  lines: TransferLineDto[];
  totals: { requested: number; dispatched: number; received: number; inTransit: number };
  carrier: string;
  reference: string;
  requestedBy: UserRef;
  approvedBy: UserRef | null;
  dispatchedAt: string | null;
  dispatchedBy: UserRef | null;
  receipts: TransferReceiptDto[];
  rejectionReason: string;
  cancelReason: string;
  closeReason: string;
  /** Adjustment that wrote off the shortfall when closed short. */
  lossAdjustment: DocRef | null;
  history: HistoryEntryDto[];
  createdAt: string;
  updatedAt: string;
}

export interface StockCountLineDto {
  id: string;
  productId: string;
  sku: string;
  name: string;
  unit: ProductRef['unit'];
  /** On hand when the count started. */
  snapshotQuantity: number;
  /** On hand now (or at posting, once posted). */
  systemQuantity: number;
  countedQuantity: number | null;
  /** counted − system, or null until counted. */
  variance: number | null;
  reason: VarianceReason | null;
  note: string;
  /** Reserved for sales orders; a count can't go below it. */
  reserved: number;
}

export interface StockCountDto {
  id: string;
  number: string;
  status: StockCountStatus;
  warehouse: WarehouseRef;
  category: { id: string; name: string } | null;
  notes: string;
  lines: StockCountLineDto[];
  progress: { counted: number; total: number; withVariance: number };
  adjustment: DocRef | null;
  createdBy: UserRef;
  submittedBy: UserRef | null;
  postedBy: UserRef | null;
  postedAt: string | null;
  history: HistoryEntryDto[];
  createdAt: string;
  updatedAt: string;
}

export interface QuarantineLevelDto {
  id: string;
  product: ProductRef;
  warehouse: WarehouseRef;
  quarantine: number;
  onHand: number;
  updatedAt: string;
}

export interface CustomerReturnLineDto {
  id: string;
  soLineId: string;
  productId: string;
  sku: string;
  name: string;
  unit: ProductRef['unit'];
  quantity: number;
  receivedQuantity: number;
  restockedQuantity: number;
  quarantinedQuantity: number;
  note: string;
  unitCost: number;
}

export interface CustomerReturnDto {
  id: string;
  number: string;
  status: CustomerReturnStatus;
  salesOrder: DocRef;
  customer: PartnerRef;
  warehouse: WarehouseRef;
  reason: ReturnReason;
  notes: string;
  lines: CustomerReturnLineDto[];
  totals: { requested: number; received: number; restocked: number; quarantined: number };
  requestedBy: UserRef;
  approvedBy: UserRef | null;
  receivedAt: string | null;
  receivedBy: UserRef | null;
  inspectedAt: string | null;
  inspectedBy: UserRef | null;
  rejectionReason: string;
  cancelReason: string;
  history: HistoryEntryDto[];
  createdAt: string;
  updatedAt: string;
}

export interface SupplierReturnLineDto {
  id: string;
  productId: string;
  sku: string;
  name: string;
  unit: ProductRef['unit'];
  quantity: number;
  source: StockBucket;
  unitCost: number;
}

export interface SupplierReturnDto {
  id: string;
  number: string;
  status: SupplierReturnStatus;
  supplier: PartnerRef;
  warehouse: WarehouseRef;
  purchaseOrder: DocRef | null;
  reason: ReturnReason;
  notes: string;
  lines: SupplierReturnLineDto[];
  totalQuantity: number;
  carrier: string;
  reference: string;
  requestedBy: UserRef;
  approvedBy: UserRef | null;
  dispatchedAt: string | null;
  dispatchedBy: UserRef | null;
  rejectionReason: string;
  cancelReason: string;
  history: HistoryEntryDto[];
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseOpsSummaryDto {
  transfersToApprove: number;
  transfersToDispatch: number;
  transfersInTransit: number;
  countsInProgress: number;
  returnsToApprove: number;
  returnsToReceive: number;
  returnsToInspect: number;
  supplierReturnsOpen: number;
  quarantinedUnits: number;
}
