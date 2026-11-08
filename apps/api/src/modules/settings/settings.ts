import { Router } from 'express';
import { Schema, model } from 'mongoose';
import { CURRENCIES, updateSettingsSchema, type SettingsDto } from '@stockflow/shared';
import { authenticate, authorize } from '../../middleware/auth.js';

const SETTINGS_ID = 'workspace';

const settingsSchema = new Schema(
  {
    _id: { type: String, default: SETTINGS_ID },
    companyName: { type: String, required: true, default: 'My Company' },
    currency: { type: String, enum: CURRENCIES, required: true, default: 'USD' },
  },
  { timestamps: true },
);

const Settings = model('Settings', settingsSchema);

export async function getSettings(): Promise<SettingsDto> {
  const doc = await Settings.findOneAndUpdate(
    { _id: SETTINGS_ID },
    { $setOnInsert: { _id: SETTINGS_ID } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return { companyName: doc.companyName, currency: doc.currency };
}

export function createSettingsRouter(): Router {
  const router = Router();
  router.use(authenticate());

  router.get('/', async (_req, res) => {
    res.json({ data: await getSettings() });
  });

  router.patch('/', authorize('settings:manage'), async (req, res) => {
    const input = updateSettingsSchema.parse(req.body);
    await getSettings();
    await Settings.updateOne({ _id: SETTINGS_ID }, { $set: input });
    res.json({ data: await getSettings() });
  });

  return router;
}
