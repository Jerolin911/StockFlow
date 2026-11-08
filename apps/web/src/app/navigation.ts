import {
  ArrowLeftRight,
  ClipboardCheck,
  PackageX,
  Repeat,
  ShieldAlert,
  Undo2,
  Boxes,
  ClipboardList,
  ClipboardPen,
  FileText,
  PackageCheck,
  PackageOpen,
  ShoppingCart,
  Contact,
  LayoutDashboard,
  Package,
  Settings,
  Tags,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import type { Permission } from '@stockflow/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  end?: boolean;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  { items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  {
    label: 'Inventory',
    items: [
      { to: '/products', label: 'Products', icon: Package },
      { to: '/stock', label: 'Stock levels', icon: Boxes, end: true },
      { to: '/stock/movements', label: 'Movements', icon: ArrowLeftRight },
      { to: '/stock/adjustments', label: 'Adjustments', icon: ClipboardList },
      { to: '/stock/transfers', label: 'Transfers', icon: Repeat },
      { to: '/stock/counts', label: 'Stock counts', icon: ClipboardCheck },
      { to: '/stock/quarantine', label: 'Quarantine', icon: ShieldAlert },
      { to: '/categories', label: 'Categories', icon: Tags },
      { to: '/warehouses', label: 'Warehouses', icon: Warehouse },
    ],
  },
  {
    label: 'Purchasing',
    items: [
      { to: '/purchase-requests', label: 'Purchase requests', icon: ClipboardPen },
      { to: '/purchase-orders', label: 'Purchase orders', icon: FileText },
      { to: '/goods-receipts', label: 'Goods receipts', icon: PackageCheck },
      { to: '/suppliers', label: 'Suppliers', icon: Truck },
    ],
  },
  {
    label: 'Sales',
    items: [
      { to: '/sales-orders', label: 'Sales orders', icon: ShoppingCart },
      { to: '/shipments', label: 'Shipments', icon: PackageOpen },
      { to: '/customers', label: 'Customers', icon: Contact },
    ],
  },
  {
    label: 'Returns',
    items: [
      { to: '/customer-returns', label: 'Customer returns', icon: Undo2 },
      { to: '/supplier-returns', label: 'Supplier returns', icon: PackageX },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/users', label: 'Users', icon: Users, permission: 'users:manage' },
      { to: '/settings', label: 'Settings', icon: Settings, permission: 'settings:manage' },
    ],
  },
];

export function visibleSections(permissions: readonly Permission[]): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !item.permission || permissions.includes(item.permission),
    ),
  })).filter((section) => section.items.length > 0);
}
