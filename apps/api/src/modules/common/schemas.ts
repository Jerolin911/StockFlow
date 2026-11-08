import { Schema } from 'mongoose';

/** Who did something, with the name at that moment so history reads correctly after renames. */
export const userSnapshotSchema = new Schema(
  { _id: { type: Schema.Types.ObjectId, ref: 'User', required: true }, name: String },
  { _id: false },
);

export const historyEntrySchema = new Schema(
  {
    action: { type: String, required: true },
    at: { type: Date, required: true },
    by: { type: userSnapshotSchema, required: true },
    note: { type: String, default: '' },
  },
  { _id: false },
);

export const partnerSnapshotSchema = new Schema(
  { _id: { type: Schema.Types.ObjectId, required: true }, code: String, name: String },
  { _id: false },
);
