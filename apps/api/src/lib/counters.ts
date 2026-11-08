import { Schema, model, type ClientSession } from 'mongoose';

const counterSchema = new Schema({ _id: String, seq: Number }, { versionKey: false });
const Counter = model('Counter', counterSchema);

export async function nextSequence(key: string, session?: ClientSession): Promise<number> {
  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, ...(session ? { session } : {}) },
  ).lean();
  return counter!.seq!;
}

/**
 * Yearly document numbers such as ADJ-2026-00042. Called inside the posting transaction,
 * so an aborted posting doesn't consume a number.
 */
export async function nextDocumentNumber(prefix: string, session: ClientSession): Promise<string> {
  const year = new Date().getUTCFullYear();
  const seq = await nextSequence(`${prefix}-${year}`, session);
  return `${prefix}-${year}-${String(seq).padStart(5, '0')}`;
}
