import { setTimeout as delay } from 'node:timers/promises';
import mongoose from 'mongoose';

interface Window {
  start: number;
  end: number;
  sim: number;
}

/**
 * Lets the demo seed run past events through the real services at today's time, then moves
 * every timestamp those steps wrote onto a simulated timeline. Each step's real time window is
 * recorded; `apply()` rewrites any date inside a window to the step's simulated time plus the
 * same offset. Dates outside every window (later steps, or plain calendar dates) are untouched.
 */
export function createTimeline() {
  const windows: Window[] = [];
  let last = 0;

  const find = (t: number) => {
    let lo = 0;
    let hi = windows.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const w = windows[mid]!;
      if (t < w.start) hi = mid - 1;
      else if (t > w.end) lo = mid + 1;
      else return w;
    }
    return undefined;
  };

  const shift = (value: unknown): [unknown, boolean] => {
    if (value instanceof Date) {
      const w = find(value.getTime());
      return w ? [new Date(w.sim + value.getTime() - w.start), true] : [value, false];
    }
    if (Array.isArray(value)) {
      let changed = false;
      const out = value.map((item) => {
        const [next, c] = shift(item);
        changed ||= c;
        return next;
      });
      return [out, changed];
    }
    if (value && typeof value === 'object' && !('_bsontype' in value)) {
      let changed = false;
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        const [next, c] = shift(item);
        changed ||= c;
        out[key] = next;
      }
      return [out, changed];
    }
    return [value, false];
  };

  return {
    /** Runs `fn` now and records that what it writes belongs at `sim`. */
    async at<T>(sim: Date, fn: () => Promise<T>): Promise<T> {
      while (Date.now() <= last) await delay(1);
      const start = Date.now();
      const result = await fn();
      const end = Date.now();
      windows.push({ start, end, sim: sim.getTime() });
      last = end;
      return result;
    },

    /** Rewrites the recorded steps' timestamps in every collection. */
    async apply() {
      if (windows.length === 0) return;
      const db = mongoose.connection.db!;
      for (const collection of await db.collections()) {
        const ops = [];
        for await (const doc of collection.find({})) {
          const [next, changed] = shift(doc);
          if (changed) {
            ops.push({ replaceOne: { filter: { _id: doc._id }, replacement: next as object } });
          }
        }
        if (ops.length > 0) await collection.bulkWrite(ops, { ordered: false });
      }
      windows.length = 0;
    },
  };
}

export type Timeline = ReturnType<typeof createTimeline>;
