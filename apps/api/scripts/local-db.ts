/**
 * Runs a persistent single-node MongoDB replica set for local development without Docker.
 * The mongod binary is the one mongodb-memory-server downloads and caches.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MongoBinary } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const port = Number(process.env.LOCAL_DB_PORT ?? 27017);
const dbPath = resolve(process.env.LOCAL_DB_PATH ?? '.data/mongo');
const host = `127.0.0.1:${port}`;

mkdirSync(dbPath, { recursive: true });
const binary = await MongoBinary.getPath();

const mongod = spawn(
  binary,
  ['--replSet', 'rs0', '--port', String(port), '--dbpath', dbPath, '--bind_ip', '127.0.0.1'],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
mongod.on('exit', (code) => {
  console.log(`mongod exited with code ${code ?? 'null'}`);
  process.exit(code ?? 1);
});

const client = new mongoose.mongo.MongoClient(`mongodb://${host}/?directConnection=true`, {
  serverSelectionTimeoutMS: 1000,
});

for (let attempt = 0; ; attempt++) {
  try {
    await client.connect();
    break;
  } catch (error) {
    if (attempt > 30) throw error;
    await delay(500);
  }
}

const admin = client.db('admin');
try {
  await admin.command({ replSetGetStatus: 1 });
} catch (error) {
  // 94 = NotYetInitialized: first run against this data directory.
  if ((error as { code?: number }).code !== 94) throw error;
  await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host }] } });
}

while (!(await admin.command({ hello: 1 })).isWritablePrimary) await delay(250);
await client.close();

console.log(`MongoDB replica set ready: mongodb://${host}/stockflow?replicaSet=rs0`);
console.log(`Data directory: ${dbPath}. Press Ctrl+C to stop.`);

const stop = () => mongod.kill('SIGINT');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
