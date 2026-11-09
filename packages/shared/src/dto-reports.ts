import type { ProductRef, StockMovementDto, WarehouseRef } from './dto.js';
import type { PartnerRef } from './dto-procurement.js';
import type { SalesOrderStatus, ShipmentStatus } from './schemas/sales.js';
import type { MovementClass, NotificationType, ReportInterval } from './schemas/reports.js';

type DocRef = { id: string; number: string };
type CategoryRef = { id: string; name: string } | null;

export interface WarehouseStockDto {
  warehouse: WarehouseRef & { isActive: boolean };
  skus: number;
  onHand: number;
  reserved: number;
  available: number;
  quarantine: number;
  /** onHand × average cost; null without the reports:inventory permission. */
  value: number | null;
  lowStock: number;
  outOfStock: number;
}

export interface OverviewDto {
  products: { active: number; inactive: number };
  stock: {
    onHand: number;
    reserved: number;
    available: number;
    quarantine: number;
    value: number | null;
  };
  /** Product × warehouse combinations at or below their threshold. */
  lowStock: number;
  /** Active products held in an active warehouse with nothing available. */
  outOfStock: number;
  warehouses: WarehouseStockDto[];
  purchasing: { pendingApproval: number; open: number; overdue: number; pendingUnits: number };
  sales: { toConfirm: number; open: number; awaitingFulfilment: number; inTransit: number };
  recentMovements: StockMovementDto[];
}

export interface TrendDto {
  interval: ReportInterval;
  from: string;
  to: string;
  series: { key: string; label: string }[];
  points: { period: string; values: Record<string, number> }[];
}

export interface VelocityRowDto {
  product: ProductRef & { category: CategoryRef };
  onHand: number;
  available: number;
  unitsIn: number;
  /** Units shipped to customers in the period. */
  unitsOut: number;
  /** Units shipped per day over the period. */
  dailyRate: number;
  /** onHand ÷ dailyRate; null when nothing shipped. */
  daysOfCover: number | null;
  movement: MovementClass;
}

export interface AvailabilityRowDto {
  product: ProductRef & { category: CategoryRef };
  onHand: number;
  reserved: number;
  available: number;
  quarantine: number;
  /** Still expected on approved purchase orders. */
  incoming: number;
  /** Dispatched on transfers and not yet received. */
  inTransit: number;
  reorderPoint: number;
  status: 'out' | 'low' | 'available';
}

export interface CategoryReportRowDto {
  category: CategoryRef;
  products: number;
  onHand: number;
  available: number;
  value: number;
  unitsIn: number;
  unitsOut: number;
}

export interface SupplierPerformanceDto {
  supplier: PartnerRef;
  orders: number;
  orderedValue: number;
  receipts: number;
  onTime: number;
  late: number;
  onTimeRate: number | null;
  averageDaysLate: number | null;
  acceptedUnits: number;
  rejectedUnits: number;
  damagedUnits: number;
  /** (rejected + damaged) ÷ delivered units. */
  issueRate: number | null;
  openOrders: number;
  overdueOrders: number;
}

export interface DeliveryRowDto {
  receipt: DocRef;
  purchaseOrder: DocRef;
  supplier: PartnerRef;
  warehouse: WarehouseRef;
  receivedAt: string;
  expectedDate: string | null;
  daysLate: number | null;
  acceptedUnits: number;
  rejectedUnits: number;
  damagedUnits: number;
}

export interface PendingPurchaseRowDto {
  purchaseOrder: DocRef;
  supplier: PartnerRef;
  warehouse: WarehouseRef;
  product: ProductRef;
  ordered: number;
  received: number;
  pending: number;
  expectedDate: string | null;
  isOverdue: boolean;
}

export interface TopProductRowDto {
  product: ProductRef & { category: CategoryRef };
  unitsShipped: number;
  /** Net of line discounts, before tax. */
  revenue: number;
  /** Average cost at dispatch. */
  cost: number;
  orders: number;
}

export interface FulfilmentStatsDto {
  ordersCreated: number;
  ordersConfirmed: number;
  ordersCompleted: number;
  ordersCancelled: number;
  unitsShipped: number;
  shipmentsDispatched: number;
  shortPicks: number;
  averageHoursToDispatch: number | null;
  averageDaysToDeliver: number | null;
  /** Orders delivered on or before their required date, of those delivered with one. */
  onTimeDeliveryRate: number | null;
  openByStatus: Partial<Record<SalesOrderStatus, number>>;
  shipmentsByStatus: Partial<Record<ShipmentStatus, number>>;
}

export interface SalesOrderReportRowDto {
  salesOrder: DocRef;
  customer: PartnerRef;
  warehouse: WarehouseRef;
  status: SalesOrderStatus;
  orderDate: string;
  requiredDate: string | null;
  ordered: number;
  shipped: number;
  delivered: number;
  total: number;
  isOverdue: boolean;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}

export interface PendingApprovalsDto {
  purchaseRequests: number;
  purchaseOrders: number;
  transfers: number;
  customerReturns: number;
  supplierReturns: number;
  stockCounts: number;
  total: number;
}

export interface AuditLogDto {
  id: string;
  at: string;
  /** Null for requests with no identity; failed sign-ins carry only the email tried. */
  actor: { id: string | null; name: string; role: string; email: string } | null;
  method: string;
  action: string;
  path: string;
  entityType: string;
  entityId: string | null;
  status: number;
  ip: string;
}
