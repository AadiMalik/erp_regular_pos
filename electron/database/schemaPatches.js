export function ensureSchemaPatches(db) {
  const columns = db.prepare('PRAGMA table_info(device_config)').all().map((c) => c.name);
  if (!columns.includes('business_name')) {
    db.exec('ALTER TABLE device_config ADD COLUMN business_name TEXT');
  }
  if (!columns.includes('business_id_locked')) {
    db.exec('ALTER TABLE device_config ADD COLUMN business_id_locked INTEGER DEFAULT 0');
  }
  if (!columns.includes('setup_step')) {
    db.exec("ALTER TABLE device_config ADD COLUMN setup_step TEXT DEFAULT 'connection'");
  }
}
