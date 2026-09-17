import { getDb, runTransaction } from '../database/index.js';
import {
  bootstrapSync,
  createApiClient,
  healthCheck,
  pullSync,
  pushSync,
} from './apiClient.js';

let syncInProgress = false;
let online = false;

export function getSyncState() {
  const db = getDb();
  const pending = db.prepare("SELECT COUNT(*) as c FROM sync_queue WHERE status = 'pending'").get().c;
  const failed = db.prepare("SELECT COUNT(*) as c FROM sync_queue WHERE status = 'failed'").get().c;
  const config = db.prepare('SELECT initialized_at FROM device_config WHERE id = 1').get();

  return {
    online,
    syncing: syncInProgress,
    initialized: !!config?.initialized_at,
    pending_count: pending,
    failed_count: failed,
    status: syncInProgress ? 'syncing' : online ? (failed ? 'sync_error' : pending ? 'pending' : 'synced') : 'offline',
  };
}

export async function checkOnline() {
  try {
    const client = createApiClient();
    await healthCheck(client);
    online = true;
    return true;
  } catch {
    online = false;
    return false;
  }
}

function upsertReference(entity, rows, idKey = null) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO reference_data (entity, entity_id, payload_json, date_updated)
    VALUES (@entity, @entity_id, @payload_json, @date_updated)
    ON CONFLICT(entity, entity_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      date_updated = excluded.date_updated
  `);

  const trx = db.transaction((items) => {
    for (const row of items) {
      const id = idKey ? row[idKey] : (
        row[`${entity.replace(/s$/, '')}_id`]
        || row.id
        || row.user_id
        || row.order_type_id
        || row.payment_method_id
        || row.sale_type_id
        || row.discount_id
        || row.complimentary_reason_id
        || row.category_id
        || row.order_source_id
        || row.expense_category_id
        || row.voucher_id
      );
      if (!id) continue;
      stmt.run({
        entity,
        entity_id: String(id),
        payload_json: JSON.stringify(row),
        date_updated: row.date_updated || null,
      });
    }
  });
  trx(rows);
}

function importBootstrapData(data) {
  const db = getDb();

  runTransaction(() => {
    const settings = data.settings || {};
    db.prepare('INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)').run('pos_setting', JSON.stringify(settings.pos_setting || {}));
    db.prepare('INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)').run('business_setting', JSON.stringify(settings.business_setting || {}));
    // Per-branch rate/type - supersedes business_setting.overall_tax_rate/
    // card_tax_rate for tax purposes (kept only for backward compat); this is
    // the one that carries tax_type (inclusive/exclusive).
    db.prepare('INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)').run('tax_rates_setting', JSON.stringify(settings.tax_rates_setting || {}));
    db.prepare('INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)').run('inventory_setting', JSON.stringify(settings.inventory_setting || {}));
    db.prepare('INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)').run('thermal_print_setting', JSON.stringify(settings.thermal_print_setting || {}));

    for (const reg of data.registers || []) {
      db.prepare(`
        INSERT OR REPLACE INTO registers (pos_register_id, branch_id, warehouse_id, name, code, mode, status, payload_json)
        VALUES (@pos_register_id, @branch_id, @warehouse_id, @name, @code, @mode, @status, @payload_json)
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

    for (const user of data.users || []) {
      const existing = db.prepare('SELECT permissions_json FROM users WHERE id = ?').get(user.id);
      db.prepare(`
        INSERT OR REPLACE INTO users (id, name, email, phone, branch_id, password_hash, permissions_json, status, date_updated)
        VALUES (@id, @name, @email, @phone, @branch_id, @password_hash, @permissions_json, @status, @date_updated)
      `).run({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone || null,
        branch_id: user.branch_id || null,
        password_hash: user.password_hash,
        permissions_json: existing?.permissions_json || JSON.stringify(user.permissions || {}),
        status: user.status || 'active',
        date_updated: user.date_updated || null,
      });
    }

    for (const p of data.products || []) {
      db.prepare(`
        INSERT OR REPLACE INTO products (product_id, category_id, name, payload_json, date_updated)
        VALUES (@product_id, @category_id, @name, @payload_json, @date_updated)
      `).run({
        product_id: p.product_id,
        category_id: p.category_id || null,
        name: p.name,
        payload_json: JSON.stringify(p),
        date_updated: p.date_updated || null,
      });
    }

    for (const v of data.variations || []) {
      db.prepare(`
        INSERT OR REPLACE INTO product_variations (product_variation_id, product_id, sku, barcode, name, sale_price, is_track_stock, payload_json, date_updated)
        VALUES (@product_variation_id, @product_id, @sku, @barcode, @name, @sale_price, @is_track_stock, @payload_json, @date_updated)
      `).run({
        product_variation_id: v.product_variation_id,
        product_id: v.product_id,
        sku: v.sku || null,
        barcode: v.barcode || null,
        name: v.name,
        sale_price: v.sale_price,
        is_track_stock: v.is_track_stock ? 1 : 0,
        payload_json: JSON.stringify(v),
        date_updated: v.date_updated || null,
      });
    }

    for (const s of data.stock_levels || []) {
      db.prepare(`
        INSERT OR REPLACE INTO stock_levels (product_variation_id, warehouse_id, quantity, server_quantity, date_updated)
        VALUES (@product_variation_id, @warehouse_id, @quantity, @quantity, @date_updated)
      `).run(s);
    }

    for (const c of data.customers || []) {
      db.prepare(`
        INSERT OR REPLACE INTO customers (user_id, code, name, email, phone, credit_limit, credit_days, store_credit_balance, is_walkin, sync_status, date_updated, payload_json)
        VALUES (@user_id, @code, @name, @email, @phone, @credit_limit, @credit_days, @store_credit_balance, @is_walkin, 'synced', @date_updated, @payload_json)
      `).run({ ...c, is_walkin: c.is_walkin ? 1 : 0, payload_json: JSON.stringify(c) });
    }

    upsertReference('order_types', data.order_types);
    upsertReference('payment_methods', data.payment_methods);
    upsertReference('banks', data.banks);
    upsertReference('sale_types', data.sale_types);
    upsertReference('discounts', data.discounts);
    upsertReference('complimentary_reasons', data.complimentary_reasons);
    upsertReference('categories', data.categories);
    upsertReference('expense_categories', data.expense_categories);
    upsertReference('order_sources', data.order_sources);
    upsertReference('vouchers', data.vouchers);
    upsertReference('variation_prices', data.variation_prices);
    upsertReference('unit_conversions', data.unit_conversions);
    upsertReference('branches', data.branches, 'branch_id');
    upsertReference('warehouses', data.warehouses, 'warehouse_id');

    if (data.cursors) {
      for (const [entity, cursor] of Object.entries(data.cursors)) {
        db.prepare('INSERT OR REPLACE INTO sync_cursors (entity, cursor_value) VALUES (?, ?)').run(entity, cursor);
      }
    }

    db.prepare('UPDATE device_config SET initialized_at = datetime(\'now\') WHERE id = 1').run();
  });
}

function getCursors() {
  const rows = getDb().prepare('SELECT entity, cursor_value FROM sync_cursors').all();
  return Object.fromEntries(rows.map((r) => [r.entity, r.cursor_value]));
}

export async function runInitialSync() {
  const config = getDb().prepare('SELECT * FROM device_config WHERE id = 1').get();
  if (!config?.api_base_url) throw new Error('API base URL not configured');

  const isUp = await checkOnline();
  if (!isUp) throw new Error('Internet connection required for initial sync');

  syncInProgress = true;
  try {
    const client = createApiClient();
    const res = await bootstrapSync(client, config.warehouse_id);
    if (!res?.Success) throw new Error(res?.Message || 'Bootstrap failed');
    importBootstrapData(res.Data);
    return res.Data;
  } finally {
    syncInProgress = false;
  }
}

export async function runSyncCycle(notify) {
  if (syncInProgress) return getSyncState();

  const config = getDb().prepare('SELECT * FROM device_config WHERE id = 1').get();
  if (!config?.initialized_at) return getSyncState();

  const isUp = await checkOnline();
  if (!isUp) {
    notify?.('sync:status', getSyncState());
    return getSyncState();
  }

  syncInProgress = true;
  notify?.('sync:status', getSyncState());

  try {
    await pushPendingTransactions();
    await pullServerChanges(config);
  } catch (err) {
    console.error('Sync error:', err.message);
  } finally {
    syncInProgress = false;
    const state = getSyncState();
    notify?.('sync:status', state);
    return state;
  }
}

async function pushPendingTransactions() {
  const db = getDb();
  const pending = db.prepare("SELECT * FROM sync_queue WHERE status IN ('pending', 'failed') ORDER BY id ASC LIMIT 50").all();
  await pushQueueRows(db, pending);
}

/**
 * Pushes a specific set of already-fetched sync_queue rows and applies the
 * results (order/session server_id + status) - the core shared by the
 * periodic/manual "sync everything" cycle above and the order-scoped
 * sync-one/sync-all below, so both stay consistent instead of drifting.
 */
async function pushQueueRows(db, rows) {
  if (!rows.length) return { pushed: 0, results: [] };

  const client = createApiClient();
  const transactions = rows.map((row) => ({
    type: row.type,
    local_id: row.local_id,
    idempotency_key: row.idempotency_key,
    payload: JSON.parse(row.payload_json),
  }));

  const res = await pushSync(client, transactions);
  const results = res?.Data?.results || [];

  for (const result of results) {
    const status = result.status === 'synced' ? 'synced' : 'failed';
    db.prepare('UPDATE sync_queue SET status = ?, last_error = ?, updated_at = datetime(\'now\') WHERE idempotency_key = ?')
      .run(status, result.error || null, result.idempotency_key);

    if (result.local_id && result.server_id) {
      if (result.local_id.startsWith('ord_')) {
        db.prepare('UPDATE orders SET server_id = ?, sync_status = ?, daily_order_id = COALESCE(?, daily_order_id) WHERE local_id = ?')
          .run(result.server_id, status, result.daily_order_id, result.local_id);
      }
      if (result.local_id.startsWith('ses_')) {
        db.prepare('UPDATE register_sessions SET server_id = ?, sync_status = ? WHERE local_id = ?')
          .run(result.server_id, status, result.local_id);
      }
    }
  }

  return { pushed: results.length, results };
}

/**
 * Pushes just one order's own queued transactions (its 'order.hold' and/or
 * 'order.complete' rows) - used by the desktop Orders panel's per-row Sync
 * button, so retrying one failed order doesn't also resend every other
 * pending session/cash-movement/expense in the same batch.
 */
export async function syncOrder(localId) {
  const db = getDb();
  const isUp = await checkOnline();
  if (!isUp) throw new Error('Internet connection required to sync.');

  const rows = db.prepare(`
    SELECT * FROM sync_queue
    WHERE local_id = ? AND type IN ('order.hold', 'order.complete') AND status IN ('pending', 'failed')
    ORDER BY id ASC
  `).all(localId);

  return pushQueueRows(db, rows);
}

/**
 * Pushes every order still pending/failed sync (Orders panel's "Sync All"
 * button) - scoped to order.* queue rows only, unlike the generic
 * runSyncCycle()/pushPendingTransactions() above which also carries
 * sessions/cash movements/expenses.
 */
export async function syncAllOrders() {
  const db = getDb();
  const isUp = await checkOnline();
  if (!isUp) throw new Error('Internet connection required to sync.');

  const rows = db.prepare(`
    SELECT * FROM sync_queue
    WHERE type IN ('order.hold', 'order.complete') AND status IN ('pending', 'failed')
    ORDER BY id ASC
    LIMIT 200
  `).all();

  return pushQueueRows(db, rows);
}

async function pullServerChanges(config) {
  const client = createApiClient();
  const cursors = getCursors();
  const res = await pullSync(client, cursors, config.warehouse_id);
  if (!res?.Success) return;

  const changes = res.Data || {};
  importBootstrapData({
    settings: changes.settings,
    products: changes.products,
    variations: changes.variations,
    customers: changes.customers,
    stock_levels: changes.stock_levels,
    users: changes.users,
    cursors: changes.cursors,
  });

  reconcileStockConflicts();
}

function reconcileStockConflicts() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT product_variation_id, warehouse_id, quantity, server_quantity
    FROM stock_levels
    WHERE server_quantity IS NOT NULL AND quantity < server_quantity
  `).all();

  for (const row of rows) {
    const deficit = row.server_quantity - row.quantity;
    db.prepare(`
      UPDATE orders SET sync_status = 'conflict', conflict_reason = ?
      WHERE local_id IN (
        SELECT DISTINCT o.local_id FROM orders o
        JOIN order_items oi ON oi.order_local_id = o.local_id
        WHERE o.sync_status = 'pending' AND oi.product_variation_id = ?
      )
    `).run(`Stock conflict: server has ${row.server_quantity}, local has ${row.quantity}`, row.product_variation_id);

    db.prepare('UPDATE stock_levels SET quantity = server_quantity WHERE product_variation_id = ? AND warehouse_id = ?')
      .run(row.product_variation_id, row.warehouse_id);
  }
}

export function startSyncScheduler(getWindow) {
  setInterval(async () => {
    await runSyncCycle((channel, data) => {
      const win = getWindow();
      // Same structured-clone guard as the invoke() reply path (see
      // ipcHandle() in ipc/handlers.js) - webContents.send() is a separate
      // IPC direction that wasn't covered by that fix.
      win?.webContents?.send(channel, JSON.parse(JSON.stringify(data)));
    });
  }, 30000);

  setInterval(async () => {
    await checkOnline();
  }, 10000);
}
