import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { runMigrations } from './migrations.js';
import { ensureSchemaPatches } from './schemaPatches.js';

let db = null;

export function getDbPath() {
  return path.join(app.getPath('userData'), 'pos.sqlite');
}

export { getDbPath as getDatabasePath };

export async function initDatabase() {
  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  ensureSchemaPatches(db);
  return db;
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export function runTransaction(fn) {
  const database = getDb();
  const trx = database.transaction(fn);
  return trx();
}
