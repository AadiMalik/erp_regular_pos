export function ensureSchemaPatches(db) {
  const columns = db.prepare('PRAGMA table_info(device_config)').all().map((c) => c.name);
  if (!columns.includes('setup_step')) {
    db.exec("ALTER TABLE device_config ADD COLUMN setup_step TEXT DEFAULT 'connection'");
  }
}
