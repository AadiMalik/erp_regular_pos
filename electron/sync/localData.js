import { getDb, runTransaction } from '../database/index.js';

export function importSetupBusinessData(data) {
  runTransaction(() => {
    const db = getDb();

    for (const user of data.users || []) {
      db.prepare(`
        INSERT OR REPLACE INTO users (
          id, name, email, phone, branch_id, password_hash, permissions_json, status, date_updated
        ) VALUES (
          @id, @name, @email, @phone, @branch_id, @password_hash, @permissions_json, @status, @date_updated
        )
      `).run({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone || null,
        branch_id: user.branch_id || null,
        password_hash: user.password_hash,
        permissions_json: JSON.stringify(user.permissions || {}),
        status: user.status || 'active',
        date_updated: user.date_updated || null,
      });
    }

    const refStmt = db.prepare(`
      INSERT INTO reference_data (entity, entity_id, payload_json, date_updated)
      VALUES (@entity, @entity_id, @payload_json, @date_updated)
      ON CONFLICT(entity, entity_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        date_updated = excluded.date_updated
    `);

    for (const row of data.branches || []) {
      refStmt.run({
        entity: 'branches',
        entity_id: String(row.branch_id),
        payload_json: JSON.stringify(row),
        date_updated: row.date_updated || null,
      });
    }

    for (const row of data.warehouses || []) {
      refStmt.run({
        entity: 'warehouses',
        entity_id: String(row.warehouse_id),
        payload_json: JSON.stringify(row),
        date_updated: row.date_updated || null,
      });
    }

    for (const reg of data.registers || []) {
      db.prepare(`
        INSERT OR REPLACE INTO registers (
          pos_register_id, branch_id, warehouse_id, name, code, mode, status, payload_json
        ) VALUES (
          @pos_register_id, @branch_id, @warehouse_id, @name, @code, @mode, @status, @payload_json
        )
      `).run({
        pos_register_id: reg.pos_register_id,
        branch_id: reg.branch_id || null,
        warehouse_id: reg.warehouse_id || null,
        name: reg.name,
        code: reg.code || null,
        mode: reg.mode || null,
        status: reg.status || null,
        payload_json: JSON.stringify(reg),
      });
    }
  });
}

export function getLocalLocationOptions() {
  const db = getDb();
  const branches = db.prepare(`
    SELECT payload_json FROM reference_data WHERE entity = 'branches' ORDER BY payload_json
  `).all().map((row) => JSON.parse(row.payload_json));

  const warehouses = db.prepare(`
    SELECT payload_json FROM reference_data WHERE entity = 'warehouses' ORDER BY payload_json
  `).all().map((row) => JSON.parse(row.payload_json));

  const registers = db.prepare(`
    SELECT pos_register_id, branch_id, warehouse_id, name, code, mode, status
    FROM registers
    ORDER BY name
  `).all();

  return { branches, warehouses, registers };
}

/**
 * Warehouse ids linked to a branch (via the synced branch_warehouses pivot,
 * carried on each warehouse's `branch_links`), in priority order. This is
 * how the desktop app resolves "which warehouses feed my current branch"
 * entirely offline after a local branch switch - no server round-trip.
 * Falls back to the warehouse's legacy single `branch_id` for old cached
 * data that predates `branch_links`.
 */
export function getLinkedWarehouseIds(branchId) {
  if (!branchId) return [];
  const warehouses = getDb().prepare(`
    SELECT payload_json FROM reference_data WHERE entity = 'warehouses'
  `).all().map((row) => JSON.parse(row.payload_json));

  return warehouses
    .map((w) => {
      const link = (w.branch_links || []).find((l) => String(l.branch_id) === String(branchId));
      if (link) return { warehouse_id: w.warehouse_id, priority: link.priority };
      if (!w.branch_links && String(w.branch_id) === String(branchId)) {
        return { warehouse_id: w.warehouse_id, priority: 0 };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.priority - b.priority)
    .map((x) => x.warehouse_id);
}

export function setCurrentUserId(userId) {
  getDb().prepare(`
    INSERT INTO app_meta (key, value) VALUES ('current_user_id', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(userId));
}

export function getLocalUserCount() {
  const row = getDb().prepare(`
    SELECT COUNT(*) as c FROM users WHERE status = 'active'
  `).get();
  return row?.c || 0;
}
