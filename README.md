# ERP Desktop POS

Standalone offline-first **Windows desktop Point of Sale** client for the Laravel ERP.

> **This is a separate repository** — not part of the ERP backend repo.
> - ERP backend (Laravel + Offline API): `C:\xampp\htdocs\erp`
> - This desktop client: `C:\xampp\htdocs\erp-desktop-pos`

## Stack

- **Electron** — native Windows shell with secure preload/IPC
- **Vue 3 + Vite** — POS UI (ported from web POS layout/CSS)
- **better-sqlite3** — local database
- **Laravel Offline API** — `/api/offline/*` on the ERP server (implemented in the ERP repo)

## First-time setup (requires internet)

1. Ensure the ERP has run migrations (`php artisan migrate` in the ERP repo)
2. In **this** repo: `npm install`
3. Start dev: `npm run dev`
4. Open the app → enter ERP base URL (e.g. `http://localhost/erp`)
5. Login with a staff account that has `pos.access`
6. Register this device and run **Initial Sync**
7. After sync completes, POS works fully offline

## Offline behavior

- Login uses bcrypt-verified password hashes synced from ERP (never plain text)
- Orders, sessions, cash movements saved locally first in SQLite transactions
- Sync queue pushes to ERP when online; pulls product/stock/settings changes
- Idempotency keys prevent duplicate orders on retry
- Status bar: Online / Offline / Syncing / Synced / Pending / Sync Error

## Production build

```bash
npm run build:win
```

Installer output: `release/`

## ERP backend requirements

In the ERP repo (`C:\xampp\htdocs\erp`):

```bash
php artisan migrate
```

Ensure the business package has `is_pos_enabled` and staff users have POS permissions.

Offline API routes/controllers/services live in the ERP repo:

- `routes/offline.php`
- `app/Http/Controllers/Api/Offline/`
- `app/Services/Concrete/Api/Offline/`

## Project structure

```
erp-desktop-pos/
  electron/           # Main process, SQLite, sync engine
    database/         # Schema & migrations
    sync/             # API client + sync scheduler
    ipc/              # IPC handlers (renderer never touches Node directly)
  src/                # Vue 3 POS UI
```

## Initialize as its own git repo (optional)

```bash
cd C:\xampp\htdocs\erp-desktop-pos
git init
git add .
git commit -m "Initial ERP Desktop POS scaffold"
```
