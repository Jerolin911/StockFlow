import type { Permission, Role } from '@stockflow/shared';

export interface AuthContext {
  user: {
    id: string;
    name: string;
    email: string;
    role: Role;
    mustChangePassword: boolean;
  };
  permissions: readonly Permission[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
