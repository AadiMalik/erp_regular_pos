import { ipcMain, shell } from 'electron';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDb, getDbPath, runTransaction } from '../database/index.js';
import {
  pingServer,
  bootstrapBusiness,
  registerDeviceSetup,
} from '../sync/apiClient.js';
import {
  getLocalLocationOptions,
  getLocalUserCount,
  getLinkedWarehouseIds,
  importSetupBusinessData,
  setCurrentUserId,
} from '../sync/localData.js';
import { runInitialSync, runSyncCycle, getSyncState, checkOnline, syncOrder, syncAllOrders } from '../sync/syncEngine.js';

export function registerIpcHandlers() {
  const db = () => getDb();

  ipcHandle('app:get-state', () => ({
    sync: getSyncState(),
    database_path: getDbPath(),
    config: db().prepare(`
      SELECT api_base_url, business_id, business_name, business_id_locked, setup_step,
             branch_id, warehouse_id, pos_device_id, device_name, initialized_at, auth_token
      FROM device_config WHERE id = 1
    `).get(),
  }));

  ipcHandle('app:get-database-path', () => ({
    path: getDbPath(),
    user_count: (() => {
      const config = db().prepare('SELECT business_id FROM device_config WHERE id = 1').get();
      return config?.business_id ? getLocalUserCount(config.business_id) : 0;
    })(),
  }));

  ipcHandle('app:open-database-folder', () => {
    shell.showItemInFolder(getDbPath());
    return { path: getDbPath() };
  });

  ipcHandle('setup:get-state', () => {
    const config = db().prepare('SELECT * FROM device_config WHERE id = 1').get() || {};
    return {
      step: config.setup_step || 'connection',
      config,
      initialized: !!config.initialized_at,
    };
  });

  ipcHandle('setup:save-connection', async ({ apiBaseUrl, businessId }) => {
    const url = apiBaseUrl.replace(/\/$/, '');
    const config = db().prepare('SELECT * FROM device_config WHERE id = 1').get();

    if (config?.business_id_locked && config.business_id && config.business_id !== businessId) {
      throw new Error('Business ID is locked for this installation and cannot be changed.');
    }

    await pingServer(url);
    const res = await bootstrapBusiness(url, businessId);
    if (!res?.Success) throw new Error(res?.Message || 'Unable to fetch business data');

    const data = res.Data || {};
    importSetupBusinessData(businessId, data);

    db().prepare(`
      INSERT INTO device_config (id, api_base_url, business_id, business_name, business_id_locked, setup_step)
      VALUES (1, ?, ?, ?, 1, 'login')
      ON CONFLICT(id) DO UPDATE SET
        api_base_url = excluded.api_base_url,
        business_id = excluded.business_id,
        business_name = excluded.business_name,
        business_id_locked = 1,
        setup_step = 'login'
    `).run(url, businessId, data.business?.name || data.name || '');

    return {
      business: data.business || { name: data.business?.name },
      user_count: data.user_count || getLocalUserCount(businessId),
      database_path: getDbPath(),
    };
  });

  ipcHandle('setup:test-connection', async ({ apiBaseUrl }) => {
    const res = await pingServer(apiBaseUrl.replace(/\/$/, ''));
    return res;
  });

  ipcHandle('setup:login', ({ email, password }) => {
    const config = db().prepare('SELECT * FROM device_config WHERE id = 1').get();
    if (!config?.business_id) throw new Error('Business ID is not configured. Complete step 1 first.');

    const user = db().prepare('SELECT * FROM users WHERE email = ? AND status = ?').get(email, 'active');
    if (!user) {
      throw new Error('User not found on this device. Re-validate the business while online to download staff accounts.');
    }
    if (user.business_id && user.business_id !== config.business_id) {
      throw new Error('This user does not belong to the business configured on this device.');
    }

    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) throw new Error('Invalid email or password.');

    setCurrentUserId(user.id);

    db().prepare(`UPDATE device_config SET setup_step = 'location' WHERE id = 1`).run();

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        business_id: user.business_id,
        branch_id: user.branch_id,
      },
      permissions: JSON.parse(user.permissions_json || '{}'),
    };
  });

  ipcHandle('setup:fetch-locations', () => {
    const locations = getLocalLocationOptions();
    if (!locations.branches.length) {
      throw new Error('No branches found locally. Go back to step 1 and re-download business data while online.');
    }
    return locations;
  });

  ipcHandle('setup:complete', async ({ branchId, registerId, deviceName, fingerprint, email, password }) => {
    const config = db().prepare('SELECT * FROM device_config WHERE id = 1').get();
    if (!config?.business_id) throw new Error('Business is not configured.');
    if (!email || !password) throw new Error('Staff login is required before registering this device.');
    if (!branchId) throw new Error('Branch is required.');

    const res = await registerDeviceSetup(config.api_base_url, {
      email,
      password,
      business_id: config.business_id,
      name: deviceName || 'Desktop POS',
      branch_id: branchId,
      pos_register_id: registerId || null,
      device_fingerprint: fingerprint || uuidv4(),
    });
    if (!res?.Success) throw new Error(res?.Message || 'Device registration failed');

    const user = res.Data.user;
    // warehouse_id is server-derived (branch's top-priority linked warehouse) for
    // legacy display only - stock itself is combined across all linked warehouses.
    db().prepare(`
      UPDATE device_config SET
        auth_token = ?,
        pos_device_id = ?,
        device_token = ?,
        device_name = ?,
        branch_id = ?,
        warehouse_id = ?,
        setup_step = 'syncing'
      WHERE id = 1
    `).run(
      res.Data.auth_token,
      res.Data.device.pos_device_id,
      res.Data.device_token,
      res.Data.device.name,
      branchId,
      res.Data.device.warehouse_id || null,
    );

    if (user) {
      db().prepare(`
        INSERT OR REPLACE INTO users (id, name, email, phone, business_id, branch_id, password_hash, permissions_json, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `).run(
        user.id,
        user.name,
        user.email,
        user.phone,
        config.business_id,
        user.branch_id,
        res.Data.password_hash,
        JSON.stringify(res.Data.permissions || {}),
      );
      setCurrentUserId(user.id);
    }

    await runInitialSync();

    db().prepare(`
      UPDATE device_config SET setup_step = 'complete', initialized_at = datetime('now') WHERE id = 1
    `).run();

    return { ok: true };
  });

  ipcHandle('auth:login', ({ email, password }) => {
    const config = db().prepare('SELECT business_id FROM device_config WHERE id = 1').get();
    const user = db().prepare('SELECT * FROM users WHERE email = ? AND status = ?').get(email, 'active');
    if (!user) throw new Error('User not found locally. Connect to internet for first login.');
    if (config?.business_id && user.business_id && user.business_id !== config.business_id) {
      throw new Error('This user does not belong to the business configured on this device.');
    }
    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) throw new Error('Invalid email or password.');

    setCurrentUserId(user.id);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        business_id: user.business_id,
        branch_id: user.branch_id,
      },
      permissions: JSON.parse(user.permissions_json || '{}'),
    };
  });

  ipcHandle('auth:logout', () => {
    db().prepare("DELETE FROM app_meta WHERE key = 'current_user_id'").run();
    return { ok: true };
  });

  ipcHandle('sync:initial', async () => runInitialSync());
  ipcHandle('sync:now', async () => runSyncCycle());
  ipcHandle('sync:status', async () => getSyncState());
  ipcHandle('network:check', async () => checkOnline());

  ipcHandle('pos:get-bootstrap', () => {
    const settings = {};
    for (const row of db().prepare('SELECT key, value_json FROM settings').all()) {
      settings[row.key] = JSON.parse(row.value_json);
    }

    const refData = (entity) => db().prepare('SELECT payload_json FROM reference_data WHERE entity = ?').all(entity).map((r) => JSON.parse(r.payload_json));

    const categories = refData('categories');
    const orderTypes = refData('order_types');
    const paymentMethods = refData('payment_methods');
    const saleTypes = refData('sale_types');
    const discounts = refData('discounts');
    const complimentaryReasons = refData('complimentary_reasons');
    const expenseCategories = refData('expense_categories');
    const branches = refData('branches');
    const warehouses = refData('warehouses');
    const banks = refData('banks');
    const registers = db().prepare('SELECT payload_json FROM registers').all().map((r) => JSON.parse(r.payload_json));
    const customers = db().prepare('SELECT payload_json FROM customers').all().map((r) => JSON.parse(r.payload_json));
    const config = db().prepare('SELECT * FROM device_config WHERE id = 1').get();

    const currentUserId = db().prepare("SELECT value FROM app_meta WHERE key = 'current_user_id'").get()?.value;
    const currentUserRow = currentUserId ? db().prepare('SELECT id, name, email, permissions_json FROM users WHERE id = ?').get(currentUserId) : null;
    const currentUser = currentUserRow ? {
      ...currentUserRow,
      permissions: JSON.parse(currentUserRow.permissions_json || '{}'),
    } : null;

    const branch = branches.find((b) => String(b.branch_id) === String(config?.branch_id));
    const warehouse = warehouses.find((w) => String(w.warehouse_id) === String(config?.warehouse_id));
    // Same "own branch or shared (null branch_id)" rule as BankService::getForBranch() on the web.
    const branchBanks = banks.filter((b) => !b.branch_id || String(b.branch_id) === String(config?.branch_id));

    return {
      settings,
      categories,
      order_types: orderTypes,
      payment_methods: paymentMethods,
      sale_types: saleTypes,
      discounts,
      complimentary_reasons: complimentaryReasons,
      expense_categories: expenseCategories,
      branches,
      warehouses,
      banks: branchBanks,
      registers,
      customers,
      current_user: currentUser,
      business_id: config?.business_id,
      business_name: config?.business_name,
      branch_id: config?.branch_id,
      branch_name: branch?.name,
      warehouse_id: config?.warehouse_id,
      warehouse_name: warehouse?.name,
    };
  });

  ipcHandle('customer:add', ({ name, email, phone }) => {
    if (!name || !email) throw new Error('Name and Email are required.');
    const config = db().prepare('SELECT business_id FROM device_config WHERE id = 1').get();
    const userId = `cust_${uuidv4()}`;
    const payload = { user_id: userId, name, email, phone: phone || null, is_walkin: 0, credit_limit: 0, credit_days: 0, store_credit_balance: 0 };

    runTransaction(() => {
      db().prepare(`
        INSERT INTO customers (user_id, code, name, email, phone, credit_limit, credit_days, store_credit_balance, is_walkin, payload_json, sync_status, date_updated)
        VALUES (?, NULL, ?, ?, ?, 0, 0, 0, 0, ?, 'pending', datetime('now'))
      `).run(userId, name, email, phone || null, JSON.stringify(payload));

      db().prepare(`
        INSERT INTO sync_queue (local_id, type, idempotency_key, payload_json, status)
        VALUES (?, 'customer.add', ?, ?, 'pending')
      `).run(userId, `${userId}:add`, JSON.stringify({ ...payload, business_id: config?.business_id }));
    });

    return payload;
  });

  ipcHandle('discount:list', () => db().prepare("SELECT payload_json FROM reference_data WHERE entity = 'discounts'").all().map((r) => JSON.parse(r.payload_json)));

  ipcHandle('voucher:lookup', ({ code }) => {
    if (!code) return null;
    const vouchers = db().prepare("SELECT payload_json FROM reference_data WHERE entity = 'vouchers'").all().map((r) => JSON.parse(r.payload_json));
    return vouchers.find((v) => String(v.code || '').toLowerCase() === String(code).toLowerCase()) || null;
  });

  ipcHandle('context:get-options', () => getLocalLocationOptions());

  ipcHandle('context:switch', ({ branchId }) => {
    // warehouse_id is kept only as a legacy display value (the branch's
    // top-priority linked warehouse) - all stock queries below combine every
    // linked warehouse via getLinkedWarehouseIds(), resolved fresh here so an
    // offline branch switch immediately reflects the new branch's warehouses.
    const warehouseId = getLinkedWarehouseIds(branchId)[0] || null;
    db().prepare('UPDATE device_config SET branch_id = ?, warehouse_id = ? WHERE id = 1').run(branchId, warehouseId);
    return { ok: true };
  });

  ipcHandle('pos:search-products', ({ term, saleTypeId }) => {
    const config = db().prepare('SELECT branch_id FROM device_config WHERE id = 1').get();
    const warehouseIds = getLinkedWarehouseIds(config?.branch_id);
    const placeholders = warehouseIds.map(() => '?').join(',') || 'NULL';
    const like = `%${term}%`;
    const rows = db().prepare(`
      SELECT pv.*, p.name as product_name, COALESCE((
        SELECT SUM(sl.quantity) FROM stock_levels sl
        WHERE sl.product_variation_id = pv.product_variation_id AND sl.warehouse_id IN (${placeholders})
      ), 0) as available_stock
      FROM product_variations pv
      JOIN products p ON p.product_id = pv.product_id
      WHERE pv.business_id = (SELECT business_id FROM device_config WHERE id = 1)
        AND (pv.barcode = ? OR pv.sku = ? OR pv.name LIKE ? OR p.name LIKE ?)
      LIMIT 30
    `).all(...warehouseIds, term, term, like, like);

    return rows.map((r) => ({
      ...JSON.parse(r.payload_json || '{}'),
      product_name: r.product_name,
      available_stock: r.is_track_stock ? r.available_stock : null,
    }));
  });

  ipcHandle('pos:get-products-by-category', ({ categoryId }) => {
    const config = db().prepare('SELECT branch_id FROM device_config WHERE id = 1').get();
    const warehouseIds = getLinkedWarehouseIds(config?.branch_id);
    const placeholders = warehouseIds.map(() => '?').join(',') || 'NULL';
    let sql = `
      SELECT p.* FROM products p
      WHERE p.business_id = (SELECT business_id FROM device_config WHERE id = 1)
    `;
    const params = [];
    if (categoryId) {
      sql += ' AND p.category_id = ?';
      params.push(categoryId);
    }
    const products = db().prepare(sql).all(...params);

    return products.map((p) => {
      const payload = JSON.parse(p.payload_json || '{}');
      const variations = db().prepare(`
        SELECT pv.*, COALESCE((
          SELECT SUM(sl.quantity) FROM stock_levels sl
          WHERE sl.product_variation_id = pv.product_variation_id AND sl.warehouse_id IN (${placeholders})
        ), 0) as available_stock
        FROM product_variations pv
        WHERE pv.product_id = ?
      `).all(...warehouseIds, p.product_id);

      return {
        ...payload,
        variations: variations.map((v) => ({
          ...JSON.parse(v.payload_json || '{}'),
          available_stock: v.is_track_stock ? v.available_stock : null,
        })),
      };
    });
  });

  ipcHandle('session:get-current', () => {
    return db().prepare("SELECT * FROM register_sessions WHERE status = 'open' ORDER BY opening_datetime DESC LIMIT 1").get();
  });

  ipcHandle('session:list', () => {
    const sessions = db().prepare('SELECT * FROM register_sessions ORDER BY opening_datetime DESC LIMIT 50').all();
    return sessions.map((s) => {
      const reg = db().prepare('SELECT payload_json FROM registers WHERE pos_register_id = ?').get(s.pos_register_id);
      return { ...s, register_name: reg ? JSON.parse(reg.payload_json).name : 'Register' };
    });
  });

  ipcHandle('session:open', ({ registerId, openingCash, notes, cashierId }) => {
    const localId = `ses_${uuidv4()}`;
    const idempotencyKey = localId;

    runTransaction(() => {
      db().prepare(`
        INSERT INTO register_sessions (local_id, pos_register_id, cashier_id, opening_cash, status, opening_datetime, sync_status, payload_json)
        VALUES (?, ?, ?, ?, 'open', datetime('now'), 'pending', ?)
      `).run(localId, registerId, cashierId, openingCash, JSON.stringify({ opening_notes: notes }));

      db().prepare(`
        INSERT INTO sync_queue (local_id, type, idempotency_key, payload_json, status)
        VALUES (?, 'session.open', ?, ?, 'pending')
      `).run(localId, idempotencyKey, JSON.stringify({
        pos_register_id: registerId,
        opening_cash: openingCash,
        opening_notes: notes,
        local_id: localId,
        idempotency_key: idempotencyKey,
      }));
    });

    return db().prepare('SELECT * FROM register_sessions WHERE local_id = ?').get(localId);
  });

  ipcHandle('session:close', ({ sessionLocalId, actualCash, notes }) => {
    runTransaction(() => {
      db().prepare(`
        UPDATE register_sessions SET status = 'closed', actual_cash = ?, closing_datetime = datetime('now'), sync_status = 'pending'
        WHERE local_id = ?
      `).run(actualCash, sessionLocalId);

      const session = db().prepare('SELECT * FROM register_sessions WHERE local_id = ?').get(sessionLocalId);
      const key = `${sessionLocalId}:close`;
      db().prepare(`
        INSERT INTO sync_queue (local_id, type, idempotency_key, payload_json, status)
        VALUES (?, 'session.close', ?, ?, 'pending')
      `).run(sessionLocalId, key, JSON.stringify({
        pos_register_session_id: session.server_id,
        actual_cash: actualCash,
        closing_notes: notes,
        local_id: sessionLocalId,
      }));
    });

    return { ok: true };
  });

  ipcHandle('order:complete', (payload) => {
    const localId = payload.local_id || `ord_${uuidv4()}`;
    const idempotencyKey = payload.idempotency_key || localId;
    const config = db().prepare('SELECT branch_id FROM device_config WHERE id = 1').get();
    const warehouseIds = getLinkedWarehouseIds(config?.branch_id);

    runTransaction(() => {
      db().prepare(`
        INSERT OR REPLACE INTO orders (local_id, idempotency_key, register_session_local_id, status, subtotal, discount_amount, tax_amount, total, paid_amount, change_amount, sync_status, payload_json, created_at)
        VALUES (?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))
      `).run(
        localId,
        idempotencyKey,
        payload.register_session_local_id,
        payload.subtotal || 0,
        payload.discount_amount || 0,
        payload.tax_amount || 0,
        payload.total || 0,
        payload.paid_amount || 0,
        payload.change_amount || 0,
        JSON.stringify(payload),
      );

      db().prepare('DELETE FROM order_items WHERE order_local_id = ?').run(localId);
      for (const line of payload.products || []) {
        const lineId = `oli_${uuidv4()}`;
        db().prepare(`
          INSERT INTO order_items (local_id, order_local_id, product_variation_id, product_name, variation_name, unit_id, quantity, unit_price, discount, line_total, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(lineId, localId, line.product_variation_id, line.product_name, line.variation_name, line.unit_id, line.quantity, line.unit_price, line.discount || 0, line.line_total, JSON.stringify(line));

        const pv = db().prepare('SELECT is_track_stock FROM product_variations WHERE product_variation_id = ?').get(line.product_variation_id);
        if (pv?.is_track_stock) {
          // Simple priority-order draw across the branch's linked warehouses (no
          // local batch/expiry data) - the server re-validates and performs the
          // authoritative FEFO/batch allocation when this sale syncs.
          let remaining = line.base_quantity || line.quantity;
          const warehousesToTry = warehouseIds.length ? warehouseIds : [null];
          for (const warehouseId of warehousesToTry) {
            if (remaining <= 0) break;
            const level = db().prepare(`
              SELECT quantity FROM stock_levels WHERE product_variation_id = ? AND warehouse_id = ?
            `).get(line.product_variation_id, warehouseId);
            const available = level?.quantity || 0;
            const isLast = warehouseId === warehousesToTry[warehousesToTry.length - 1];
            const take = isLast ? remaining : Math.min(remaining, Math.max(available, 0));

            db().prepare(`
              UPDATE stock_levels SET quantity = quantity - ? WHERE product_variation_id = ? AND warehouse_id = ?
            `).run(take, line.product_variation_id, warehouseId);

            db().prepare(`
              INSERT INTO stock_movements (local_id, product_variation_id, warehouse_id, quantity_delta, reference_type, reference_local_id, sync_status, created_at)
              VALUES (?, ?, ?, ?, 'order', ?, 'pending', datetime('now'))
            `).run(`stm_${uuidv4()}`, line.product_variation_id, warehouseId, -take, localId);

            remaining -= take;
          }
        }
      }

      db().prepare('DELETE FROM order_payments WHERE order_local_id = ?').run(localId);
      for (const pay of payload.payments || []) {
        db().prepare(`
          INSERT INTO order_payments (local_id, order_local_id, payment_method_id, amount, payload_json)
          VALUES (?, ?, ?, ?, ?)
        `).run(`pay_${uuidv4()}`, localId, pay.payment_method_id, pay.amount, JSON.stringify(pay));
      }

      db().prepare(`
        INSERT INTO sync_queue (local_id, type, idempotency_key, payload_json, status)
        VALUES (?, 'order.complete', ?, ?, 'pending')
      `).run(localId, `${idempotencyKey}:complete`, JSON.stringify({
        save_payload: payload,
        order_id: payload.server_order_id || null,
        local_id: localId,
        idempotency_key: idempotencyKey,
      }));
    });

    return { local_id: localId, idempotency_key: idempotencyKey };
  });

  ipcHandle('order:hold', (payload) => {
    const localId = payload.local_id || `ord_${uuidv4()}`;
    const idempotencyKey = payload.idempotency_key || `${localId}:hold`;

    runTransaction(() => {
      db().prepare(`
        INSERT OR REPLACE INTO orders (local_id, idempotency_key, register_session_local_id, status, subtotal, discount_amount, tax_amount, total, paid_amount, change_amount, sync_status, payload_json, created_at)
        VALUES (?, ?, ?, 'held', ?, ?, ?, ?, 0, 0, 'pending', ?, COALESCE((SELECT created_at FROM orders WHERE local_id = ?), datetime('now')))
      `).run(
        localId,
        idempotencyKey,
        payload.register_session_local_id,
        payload.subtotal || 0,
        payload.discount_amount || 0,
        payload.tax_amount || 0,
        payload.total || 0,
        JSON.stringify(payload),
        localId,
      );

      db().prepare('DELETE FROM order_items WHERE order_local_id = ?').run(localId);
      for (const line of payload.products || []) {
        db().prepare(`
          INSERT INTO order_items (local_id, order_local_id, product_variation_id, product_name, variation_name, unit_id, quantity, unit_price, discount, line_total, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(`oli_${uuidv4()}`, localId, line.product_variation_id, line.product_name, line.variation_name, line.unit_id, line.quantity, line.unit_price, line.discount || 0, line.line_total, JSON.stringify(line));
      }

      db().prepare(`
        INSERT INTO sync_queue (local_id, type, idempotency_key, payload_json, status)
        VALUES (?, 'order.hold', ?, ?, 'pending')
      `).run(localId, idempotencyKey, JSON.stringify({ save_payload: payload, local_id: localId }));
    });

    return { local_id: localId, idempotency_key: idempotencyKey };
  });

  ipcHandle('order:held-list', ({ sessionLocalId }) => {
    const orders = db().prepare(`
      SELECT local_id, total, created_at FROM orders
      WHERE status = 'held' AND (register_session_local_id = ? OR ? IS NULL)
      ORDER BY created_at DESC
    `).all(sessionLocalId || null, sessionLocalId || null);

    return orders.map((o) => ({
      local_id: o.local_id,
      total: o.total,
      created_at: o.created_at,
      items: db().prepare('SELECT * FROM order_items WHERE order_local_id = ?').all(o.local_id).map((i) => ({ ...i, payload: JSON.parse(i.payload_json || '{}') })),
    }));
  });

  ipcHandle('order:resume', ({ localId }) => {
    const order = db().prepare('SELECT * FROM orders WHERE local_id = ?').get(localId);
    if (!order) throw new Error('Held order not found.');
    const items = db().prepare('SELECT * FROM order_items WHERE order_local_id = ?').all(localId);
    return {
      local_id: order.local_id,
      payload: JSON.parse(order.payload_json || '{}'),
      items: items.map((i) => ({ ...i, payload: JSON.parse(i.payload_json || '{}') })),
    };
  });

  ipcHandle('order:list', ({ onlyPending } = {}) => {
    let sql = "SELECT * FROM orders WHERE status = 'posted'";
    if (onlyPending) sql += " AND sync_status IN ('pending', 'failed')";
    sql += ' ORDER BY created_at DESC LIMIT 200';

    return db().prepare(sql).all().map((o) => {
      const payload = JSON.parse(o.payload_json || '{}');
      const customer = payload.customer_id
        ? db().prepare('SELECT name FROM customers WHERE user_id = ?').get(payload.customer_id)
        : null;
      const item_count = db().prepare('SELECT COUNT(*) as c FROM order_items WHERE order_local_id = ?').get(o.local_id).c;

      return {
        local_id: o.local_id,
        server_id: o.server_id,
        daily_order_id: o.daily_order_id,
        total: o.total,
        paid_amount: o.paid_amount,
        change_amount: o.change_amount,
        sync_status: o.sync_status,
        conflict_reason: o.conflict_reason,
        created_at: o.created_at,
        item_count,
        customer_name: customer?.name || null,
      };
    });
  });

  ipcHandle('order:detail', ({ localId }) => {
    const order = db().prepare('SELECT * FROM orders WHERE local_id = ?').get(localId);
    if (!order) throw new Error('Order not found.');

    const payload = JSON.parse(order.payload_json || '{}');
    const items = db().prepare('SELECT * FROM order_items WHERE order_local_id = ?').all(localId)
      .map((i) => ({ ...i, payload: JSON.parse(i.payload_json || '{}') }));
    const payments = db().prepare('SELECT * FROM order_payments WHERE order_local_id = ?').all(localId)
      .map((p) => ({ ...p, payload: JSON.parse(p.payload_json || '{}') }));
    const customer = payload.customer_id
      ? db().prepare('SELECT name, phone, email FROM customers WHERE user_id = ?').get(payload.customer_id)
      : null;
    const sync_history = db().prepare(`
      SELECT type, status, last_error, updated_at FROM sync_queue WHERE local_id = ? ORDER BY id ASC
    `).all(localId);

    return {
      local_id: order.local_id,
      server_id: order.server_id,
      daily_order_id: order.daily_order_id,
      subtotal: order.subtotal,
      discount_amount: order.discount_amount,
      tax_amount: order.tax_amount,
      tax_type: payload.tax_type || 'exclusive',
      tax: payload.tax,
      tax_discount: payload.tax_discount,
      tax_discount_amount: payload.tax_discount_amount,
      total: order.total,
      paid_amount: order.paid_amount,
      change_amount: order.change_amount,
      sync_status: order.sync_status,
      conflict_reason: order.conflict_reason,
      created_at: order.created_at,
      customer,
      items,
      payments,
      sync_history,
    };
  });

  ipcHandle('order:sync-one', async ({ localId }) => syncOrder(localId));

  ipcHandle('order:sync-all', async () => syncAllOrders());

  ipcHandle('session:cash-movement', ({ sessionLocalId, type, amount, reason }) => {
    if (!amount || Number(amount) <= 0) throw new Error('Please enter a valid amount.');
    const localId = `cm_${uuidv4()}`;

    runTransaction(() => {
      db().prepare(`
        INSERT INTO register_cash_movements (local_id, pos_register_session_id, type, amount, reason, sync_status, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))
      `).run(localId, sessionLocalId, type, amount, reason || null);

      db().prepare(`
        INSERT INTO sync_queue (local_id, type, idempotency_key, payload_json, status)
        VALUES (?, 'session.cash_movement', ?, ?, 'pending')
      `).run(localId, `${localId}:cash`, JSON.stringify({ pos_register_session_id: sessionLocalId, type, amount, reason, local_id: localId }));
    });

    return { ok: true };
  });

  ipcHandle('expense:add', ({ sessionLocalId, categoryId, amount, description }) => {
    if (!amount || Number(amount) <= 0) throw new Error('Please enter a valid amount.');
    const localId = `exp_${uuidv4()}`;

    runTransaction(() => {
      db().prepare(`
        INSERT INTO expenses (local_id, pos_register_session_id, expense_category_id, amount, description, sync_status, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))
      `).run(localId, sessionLocalId || null, categoryId || null, amount, description || null);

      db().prepare(`
        INSERT INTO sync_queue (local_id, type, idempotency_key, payload_json, status)
        VALUES (?, 'expense.add', ?, ?, 'pending')
      `).run(localId, `${localId}:expense`, JSON.stringify({ pos_register_session_id: sessionLocalId, expense_category_id: categoryId, amount, description, local_id: localId }));
    });

    return { ok: true };
  });

  ipcHandle('session:close-summary', ({ sessionLocalId }) => {
    const session = db().prepare('SELECT * FROM register_sessions WHERE local_id = ?').get(sessionLocalId);
    if (!session) throw new Error('Session not found.');

    const orders = db().prepare("SELECT * FROM orders WHERE register_session_local_id = ? AND status = 'posted'").all(sessionLocalId);
    const cashIn = db().prepare("SELECT COALESCE(SUM(amount), 0) as total FROM register_cash_movements WHERE pos_register_session_id = ? AND type = 'in'").get(sessionLocalId).total;
    const cashOut = db().prepare("SELECT COALESCE(SUM(amount), 0) as total FROM register_cash_movements WHERE pos_register_session_id = ? AND type = 'out'").get(sessionLocalId).total;
    const expensesTotal = db().prepare('SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE pos_register_session_id = ?').get(sessionLocalId).total;

    const totalOrders = orders.length;
    const totalSales = orders.reduce((sum, o) => sum + (o.total || 0), 0);

    const paymentTotals = {};
    for (const o of orders) {
      const payments = db().prepare('SELECT * FROM order_payments WHERE order_local_id = ?').all(o.local_id);
      for (const p of payments) {
        const methodId = p.payment_method_id || 'unknown';
        paymentTotals[methodId] = paymentTotals[methodId] || { payment_method_id: methodId, order_count: 0, total: 0 };
        paymentTotals[methodId].order_count += 1;
        paymentTotals[methodId].total += p.amount || 0;
      }
    }

    const cashMethodTotal = orders.reduce((sum, o) => {
      const payments = db().prepare('SELECT * FROM order_payments WHERE order_local_id = ?').all(o.local_id);
      const isCashOnly = payments.length && payments.every((p) => {
        const m = JSON.parse(p.payload_json || '{}');
        return (m.type || '').toLowerCase() === 'cash' || !m.type;
      });
      return sum + (isCashOnly ? o.total : 0);
    }, 0);

    const expectedCash = (session.opening_cash || 0) + cashMethodTotal + cashIn - cashOut - expensesTotal;

    return {
      total_orders: totalOrders,
      total_sales_amount: totalSales,
      payment_method_totals: Object.values(paymentTotals),
      total_discount: orders.reduce((s, o) => s + (o.discount_amount || 0), 0),
      total_tax: orders.reduce((s, o) => s + (o.tax_amount || 0), 0),
      opening_cash: session.opening_cash || 0,
      cash_movements_in: cashIn,
      cash_movements_out: cashOut,
      total_expenses: expensesTotal,
      expected_cash: expectedCash,
      actual_cash: session.actual_cash,
    };
  });
}

function ipcHandle(channel, handler) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      const data = await handler(payload || {});
      // IPC replies go through Electron's structured-clone algorithm, which
      // rejects some shapes silently-until-runtime (BigInt from a huge
      // SQLite integer, a class instance, etc.) - a handler's return value
      // is always meant to be plain JSON anyway (it becomes reactive Vue
      // state), so round-tripping it here guarantees every reply is
      // cloneable instead of every handler having to get this right itself.
      return { success: true, data: data === undefined ? null : JSON.parse(JSON.stringify(data)) };
    } catch (error) {
      return { success: false, error: error.message || 'Unknown error' };
    }
  });
}
