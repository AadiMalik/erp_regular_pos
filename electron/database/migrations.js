export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_cursors (
      entity TEXT PRIMARY KEY,
      cursor_value TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      business_id TEXT,
      branch_id TEXT,
      password_hash TEXT NOT NULL,
      permissions_json TEXT,
      status TEXT DEFAULT 'active',
      date_updated TEXT
    );

    CREATE TABLE IF NOT EXISTS device_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      api_base_url TEXT,
      business_id TEXT,
      branch_id TEXT,
      warehouse_id TEXT,
      pos_device_id TEXT,
      device_token TEXT,
      device_name TEXT,
      auth_token TEXT,
      business_name TEXT,
      business_id_locked INTEGER DEFAULT 0,
      setup_step TEXT DEFAULT 'connection',
      initialized_at TEXT
    );

    CREATE TABLE IF NOT EXISTS registers (
      pos_register_id TEXT PRIMARY KEY,
      business_id TEXT,
      branch_id TEXT,
      warehouse_id TEXT,
      name TEXT,
      code TEXT,
      mode TEXT,
      status TEXT,
      payload_json TEXT
    );

    CREATE TABLE IF NOT EXISTS register_sessions (
      local_id TEXT PRIMARY KEY,
      server_id TEXT,
      pos_register_id TEXT,
      cashier_id TEXT,
      opening_cash REAL DEFAULT 0,
      actual_cash REAL,
      status TEXT DEFAULT 'open',
      opening_datetime TEXT,
      closing_datetime TEXT,
      sync_status TEXT DEFAULT 'pending',
      payload_json TEXT
    );

    CREATE TABLE IF NOT EXISTS register_cash_movements (
      local_id TEXT PRIMARY KEY,
      server_id TEXT,
      pos_register_session_id TEXT,
      type TEXT,
      amount REAL,
      reason TEXT,
      sync_status TEXT DEFAULT 'pending',
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS expenses (
      local_id TEXT PRIMARY KEY,
      server_id TEXT,
      pos_register_session_id TEXT,
      expense_category_id TEXT,
      amount REAL,
      description TEXT,
      sync_status TEXT DEFAULT 'pending',
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      product_id TEXT PRIMARY KEY,
      business_id TEXT,
      category_id TEXT,
      name TEXT,
      payload_json TEXT,
      date_updated TEXT
    );

    CREATE TABLE IF NOT EXISTS product_variations (
      product_variation_id TEXT PRIMARY KEY,
      product_id TEXT,
      business_id TEXT,
      sku TEXT,
      barcode TEXT,
      name TEXT,
      sale_price REAL,
      is_track_stock INTEGER DEFAULT 0,
      payload_json TEXT,
      date_updated TEXT
    );

    CREATE TABLE IF NOT EXISTS stock_levels (
      product_variation_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      quantity REAL DEFAULT 0,
      server_quantity REAL,
      date_updated TEXT,
      PRIMARY KEY (product_variation_id, warehouse_id)
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      local_id TEXT PRIMARY KEY,
      product_variation_id TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      quantity_delta REAL NOT NULL,
      reference_type TEXT,
      reference_local_id TEXT,
      sync_status TEXT DEFAULT 'pending',
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS customers (
      user_id TEXT PRIMARY KEY,
      code TEXT,
      name TEXT,
      email TEXT,
      phone TEXT,
      credit_limit REAL DEFAULT 0,
      credit_days INTEGER DEFAULT 0,
      store_credit_balance REAL DEFAULT 0,
      is_walkin INTEGER DEFAULT 0,
      payload_json TEXT,
      sync_status TEXT DEFAULT 'synced',
      date_updated TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      local_id TEXT PRIMARY KEY,
      server_id TEXT,
      idempotency_key TEXT UNIQUE,
      register_session_local_id TEXT,
      register_session_server_id TEXT,
      daily_order_id INTEGER,
      status TEXT DEFAULT 'draft',
      subtotal REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      change_amount REAL DEFAULT 0,
      sync_status TEXT DEFAULT 'pending',
      conflict_reason TEXT,
      payload_json TEXT,
      created_at TEXT,
      posted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS order_items (
      local_id TEXT PRIMARY KEY,
      order_local_id TEXT NOT NULL,
      product_variation_id TEXT,
      product_name TEXT,
      variation_name TEXT,
      unit_id TEXT,
      quantity REAL,
      unit_price REAL,
      discount REAL DEFAULT 0,
      line_total REAL,
      payload_json TEXT
    );

    CREATE TABLE IF NOT EXISTS order_payments (
      local_id TEXT PRIMARY KEY,
      order_local_id TEXT NOT NULL,
      payment_method_id TEXT,
      amount REAL,
      payload_json TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_id TEXT,
      type TEXT NOT NULL,
      idempotency_key TEXT UNIQUE,
      payload_json TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reference_data (
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      date_updated TEXT,
      PRIMARY KEY (entity, entity_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
  `);
}
