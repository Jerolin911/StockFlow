import type { Role } from './roles.js';

export const PERMISSIONS = [
  'users:manage',
  'settings:manage',
  'audit:read',
  'warehouses:manage',
  'categories:manage',
  'products:write',
  'stock:adjust',
  'stock:transfer',
  'transfers:approve',
  'stock:count',
  'goodsReceipts:create',
  'shipments:create',
  'suppliers:write',
  'purchaseRequests:create',
  'purchaseRequests:approve',
  'purchaseOrders:write',
  'purchaseOrders:approve',
  'customers:write',
  'customers:erase',
  'salesOrders:write',
  'customerReturns:write',
  'supplierReturns:write',
  'supplierReturns:approve',
  'returns:process',
  'reports:inventory',
  'reports:purchasing',
  'reports:fulfilment',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  inventory_manager: [
    'warehouses:manage',
    'categories:manage',
    'products:write',
    'stock:adjust',
    'stock:transfer',
    'transfers:approve',
    'stock:count',
    'goodsReceipts:create',
    'shipments:create',
    'purchaseRequests:create',
    'supplierReturns:write',
    'returns:process',
    'reports:inventory',
  ],
  procurement_manager: [
    'suppliers:write',
    'purchaseRequests:create',
    'purchaseRequests:approve',
    'purchaseOrders:write',
    'purchaseOrders:approve',
    'supplierReturns:write',
    'supplierReturns:approve',
    'reports:purchasing',
  ],
  sales_manager: [
    'customers:write',
    'salesOrders:write',
    'customerReturns:write',
    'reports:fulfilment',
  ],
  staff: [
    'stock:transfer',
    'stock:count',
    'goodsReceipts:create',
    'shipments:create',
    'purchaseRequests:create',
    'returns:process',
  ],
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  'users:manage': 'Manage users and roles',
  'settings:manage': 'Manage workspace settings',
  'audit:read': 'View the audit log',
  'warehouses:manage': 'Manage warehouses',
  'categories:manage': 'Manage product categories',
  'products:write': 'Create and edit products',
  'stock:adjust': 'Post adjustments, counts and quarantine changes',
  'stock:transfer': 'Request, dispatch and receive transfers',
  'transfers:approve': 'Approve and close transfers',
  'stock:count': 'Record physical stock counts',
  'goodsReceipts:create': 'Receive goods against purchase orders',
  'shipments:create': 'Pick, pack and dispatch shipments',
  'suppliers:write': 'Create and edit suppliers and their prices',
  'purchaseRequests:create': 'Raise purchase requests',
  'purchaseRequests:approve': 'Approve purchase requests',
  'purchaseOrders:write': 'Create and submit purchase orders',
  'purchaseOrders:approve': 'Approve purchase orders',
  'customers:write': 'Create and edit customers',
  'customers:erase': "Erase a customer's personal data",
  'salesOrders:write': 'Create and confirm sales orders',
  'customerReturns:write': 'Raise and approve customer returns',
  'supplierReturns:write': 'Raise supplier returns',
  'supplierReturns:approve': 'Approve supplier returns',
  'returns:process': 'Receive, inspect and send back returns',
  'reports:inventory': 'View inventory reports',
  'reports:purchasing': 'View purchasing reports',
  'reports:fulfilment': 'View fulfilment reports',
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
