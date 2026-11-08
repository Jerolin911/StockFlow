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
  'goodsReceipts:create',
  'shipments:create',
  'suppliers:write',
  'purchaseOrders:write',
  'purchaseOrders:approve',
  'customers:write',
  'salesOrders:write',
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
    'goodsReceipts:create',
    'shipments:create',
    'reports:inventory',
  ],
  procurement_manager: [
    'suppliers:write',
    'purchaseOrders:write',
    'purchaseOrders:approve',
    'reports:purchasing',
  ],
  sales_manager: ['customers:write', 'salesOrders:write', 'reports:fulfilment'],
  staff: ['stock:transfer', 'goodsReceipts:create', 'shipments:create'],
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  'users:manage': 'Manage users and roles',
  'settings:manage': 'Manage workspace settings',
  'audit:read': 'View the audit log',
  'warehouses:manage': 'Manage warehouses',
  'categories:manage': 'Manage product categories',
  'products:write': 'Create and edit products',
  'stock:adjust': 'Post stock adjustments',
  'stock:transfer': 'Transfer stock between warehouses',
  'goodsReceipts:create': 'Receive goods against purchase orders',
  'shipments:create': 'Ship sales orders',
  'suppliers:write': 'Create and edit suppliers',
  'purchaseOrders:write': 'Create and submit purchase orders',
  'purchaseOrders:approve': 'Approve purchase orders',
  'customers:write': 'Create and edit customers',
  'salesOrders:write': 'Create and confirm sales orders',
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
