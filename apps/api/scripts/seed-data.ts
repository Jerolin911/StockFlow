import type { Role } from '@stockflow/shared';
import { hashPassword } from '../src/modules/auth/passwords.js';
import { Session } from '../src/modules/auth/session.model.js';
import { User } from '../src/modules/users/user.model.js';

/** Demo-only credentials. Every seeded account uses this password unless SEED_PASSWORD is set. */
export const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'StockFlow-Demo-2026';

export const DEMO_USERS: { name: string; email: string; role: Role }[] = [
  { name: 'Dana Whitfield', email: 'admin@stockflow.test', role: 'admin' },
  { name: 'Marcus Chen', email: 'inventory@stockflow.test', role: 'inventory_manager' },
  { name: 'Priya Nair', email: 'procurement@stockflow.test', role: 'procurement_manager' },
  { name: 'Lucas Romero', email: 'sales@stockflow.test', role: 'sales_manager' },
  { name: 'Amara Okafor', email: 'staff@stockflow.test', role: 'staff' },
];

export async function seedDatabase(): Promise<void> {
  await Promise.all([User.deleteMany({}), Session.deleteMany({})]);
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await User.insertMany(DEMO_USERS.map((user) => ({ ...user, passwordHash })));
}
