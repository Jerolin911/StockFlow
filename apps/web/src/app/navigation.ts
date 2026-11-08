import {
  ArrowLeftRight,
  Boxes,
  ClipboardList,
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
      { to: '/categories', label: 'Categories', icon: Tags },
      { to: '/warehouses', label: 'Warehouses', icon: Warehouse },
    ],
  },
  { label: 'Purchasing', items: [{ to: '/suppliers', label: 'Suppliers', icon: Truck }] },
  { label: 'Sales', items: [{ to: '/customers', label: 'Customers', icon: Contact }] },
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
