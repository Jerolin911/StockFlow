import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, hasPermission } from './permissions.js';
import { ROLES } from './roles.js';
import { changePasswordSchema, loginSchema, passwordSchema } from './schemas/auth.js';
import { listUsersQuerySchema, updateUserSchema } from './schemas/users.js';

describe('role permissions', () => {
  it('grants admin every permission', () => {
    for (const permission of PERMISSIONS) expect(hasPermission('admin', permission)).toBe(true);
  });

  it('defines permissions for every role using known permission names', () => {
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(permission);
    }
  });

  it('keeps user management admin-only', () => {
    for (const role of ROLES.filter((r) => r !== 'admin')) {
      expect(hasPermission(role, 'users:manage')).toBe(false);
    }
  });

  it('separates role responsibilities', () => {
    expect(hasPermission('inventory_manager', 'products:write')).toBe(true);
    expect(hasPermission('inventory_manager', 'purchaseOrders:approve')).toBe(false);
    expect(hasPermission('procurement_manager', 'purchaseOrders:approve')).toBe(true);
    expect(hasPermission('procurement_manager', 'products:write')).toBe(false);
    expect(hasPermission('sales_manager', 'salesOrders:write')).toBe(true);
    expect(hasPermission('sales_manager', 'shipments:create')).toBe(false);
    expect(hasPermission('staff', 'shipments:create')).toBe(true);
    expect(hasPermission('staff', 'stock:adjust')).toBe(false);
  });
});

describe('auth schemas', () => {
  it('normalises login email', () => {
    expect(loginSchema.parse({ email: '  Admin@Example.COM ', password: 'x' }).email).toBe(
      'admin@example.com',
    );
  });

  it('enforces password length in characters and bytes', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(72)).success).toBe(true);
    expect(passwordSchema.safeParse('a'.repeat(73)).success).toBe(false);
    // 25 three-byte characters = 75 bytes
    expect(passwordSchema.safeParse('€'.repeat(25)).success).toBe(false);
  });

  it('rejects reusing the current password', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'same-password-1',
      newPassword: 'same-password-1',
    });
    expect(result.success).toBe(false);
  });
});

describe('user schemas', () => {
  it('rejects an empty update', () => {
    expect(updateUserSchema.safeParse({}).success).toBe(false);
  });

  it('applies list defaults and rejects unknown sort fields', () => {
    expect(listUsersQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 25, sort: 'name' });
    expect(listUsersQuerySchema.safeParse({ sort: 'passwordHash' }).success).toBe(false);
    expect(listUsersQuerySchema.parse({ sort: '-lastLoginAt' }).sort).toBe('-lastLoginAt');
  });
});
