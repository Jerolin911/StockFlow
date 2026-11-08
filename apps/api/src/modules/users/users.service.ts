import type { FilterQuery } from 'mongoose';
import {
  ROLES,
  type CreateUserInput,
  type ListUsersQuery,
  type Paginated,
  type ResetPasswordInput,
  type Role,
  type UpdateUserInput,
  type UserDto,
  type UserStatsDto,
} from '@stockflow/shared';
import { AppError, invalidState, isDuplicateKeyError, notFound } from '../../lib/errors.js';
import { escapeRegex, parseSort } from '../../lib/http.js';
import { hashPassword } from '../auth/passwords.js';
import { revokeUserSessions } from '../auth/auth.service.js';
import { toUserDto } from './user.dto.js';
import { User, type UserRecord } from './user.model.js';

const emailTaken = () =>
  new AppError(409, 'CONFLICT', 'A user with this email already exists', [
    { path: 'email', message: 'A user with this email already exists' },
  ]);

export async function listUsers(query: ListUsersQuery): Promise<Paginated<UserDto>> {
  const filter: FilterQuery<UserRecord> = {};
  if (query.role) filter.role = query.role;
  if (query.status) filter.isActive = query.status === 'active';
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ name: pattern }, { email: pattern }];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ ...parseSort(query.sort), _id: 1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean(),
    User.countDocuments(filter),
  ]);

  return {
    data: users.map(toUserDto),
    meta: { page: query.page, pageSize: query.pageSize, total },
  };
}

export async function getUserStats(): Promise<UserStatsDto> {
  const rows = await User.aggregate<{ _id: { role: Role; isActive: boolean }; count: number }>([
    { $group: { _id: { role: '$role', isActive: '$isActive' }, count: { $sum: 1 } } },
  ]);

  const activeByRole = Object.fromEntries(ROLES.map((role) => [role, 0])) as Record<Role, number>;
  let active = 0;
  let inactive = 0;
  for (const row of rows) {
    if (row._id.isActive) {
      active += row.count;
      activeByRole[row._id.role] += row.count;
    } else {
      inactive += row.count;
    }
  }
  return { total: active + inactive, active, inactive, activeByRole };
}

export async function getUser(id: string): Promise<UserDto> {
  const user = await User.findById(id).lean();
  if (!user) throw notFound('User');
  return toUserDto(user);
}

export async function createUser(input: CreateUserInput): Promise<UserDto> {
  try {
    const user = await User.create({
      name: input.name,
      email: input.email,
      role: input.role,
      passwordHash: await hashPassword(input.password),
      mustChangePassword: true,
    });
    return toUserDto(user.toObject());
  } catch (error) {
    if (isDuplicateKeyError(error)) throw emailTaken();
    throw error;
  }
}

export async function updateUser(
  id: string,
  input: UpdateUserInput,
  actorId: string,
): Promise<UserDto> {
  const user = await User.findById(id);
  if (!user) throw notFound('User');

  if (id === actorId) {
    if (input.role !== undefined && input.role !== user.role) {
      throw invalidState('You cannot change your own role');
    }
    if (input.isActive === false) throw invalidState('You cannot deactivate your own account');
  }

  const deactivating = input.isActive === false && user.isActive;
  user.set(input);
  try {
    await user.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) throw emailTaken();
    throw error;
  }

  if (deactivating) await revokeUserSessions(id);
  return toUserDto(user.toObject());
}

export async function resetPassword(
  id: string,
  input: ResetPasswordInput,
  actorId: string,
): Promise<UserDto> {
  if (id === actorId) throw invalidState('Use Change password to update your own password');

  const user = await User.findById(id);
  if (!user) throw notFound('User');

  user.passwordHash = await hashPassword(input.password);
  user.mustChangePassword = true;
  await user.save();
  await revokeUserSessions(id);
  return toUserDto(user.toObject());
}
