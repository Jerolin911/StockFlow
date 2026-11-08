import { Router } from 'express';
import {
  createUserSchema,
  listUsersQuerySchema,
  resetPasswordSchema,
  updateUserSchema,
} from '@stockflow/shared';
import { parseId } from '../../lib/http.js';
import { authenticate, authorize, requireAuth } from '../../middleware/auth.js';
import * as usersService from './users.service.js';

export function createUsersRouter(): Router {
  const router = Router();
  router.use(authenticate(), authorize('users:manage'));

  router.get('/', async (req, res) => {
    res.json(await usersService.listUsers(listUsersQuerySchema.parse(req.query)));
  });

  router.get('/stats', async (_req, res) => {
    res.json({ data: await usersService.getUserStats() });
  });

  router.post('/', async (req, res) => {
    const user = await usersService.createUser(createUserSchema.parse(req.body));
    res.status(201).json({ data: user });
  });

  router.get('/:id', async (req, res) => {
    res.json({ data: await usersService.getUser(parseId(req.params.id, 'User')) });
  });

  router.patch('/:id', async (req, res) => {
    const user = await usersService.updateUser(
      parseId(req.params.id, 'User'),
      updateUserSchema.parse(req.body),
      requireAuth(req).user.id,
    );
    res.json({ data: user });
  });

  router.post('/:id/reset-password', async (req, res) => {
    const user = await usersService.resetPassword(
      parseId(req.params.id, 'User'),
      resetPasswordSchema.parse(req.body),
      requireAuth(req).user.id,
    );
    res.json({ data: user });
  });

  return router;
}
