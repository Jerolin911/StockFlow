export const ROLES = [
  'admin',
  'inventory_manager',
  'procurement_manager',
  'sales_manager',
  'staff',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  inventory_manager: 'Inventory Manager',
  procurement_manager: 'Procurement Manager',
  sales_manager: 'Sales Manager',
  staff: 'Staff',
};
