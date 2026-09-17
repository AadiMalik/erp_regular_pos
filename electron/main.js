import { app, BrowserWindow, ipcMain, shell, dialog, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './database/index.js';
import { registerIpcHandlers } from './ipc/handlers.js';
import { startSyncScheduler } from './sync/syncEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow = null;

function resolveRendererIndex() {
  if (isDev) {
    return null;
  }
  return path.join(app.getAppPath(), 'dist', 'index.html');
}

function resolvePreloadPath() {
  const preloadName = 'preload.cjs';
  if (isDev) {
    return path.join(__dirname, preloadName);
  }
  return path.join(app.getAppPath(), 'dist-electron', preloadName);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 720,
    title: 'ERP Desktop POS',
    show: false,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = resolveRendererIndex();
    mainWindow.loadFile(indexPath);
  }

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    dialog.showErrorBox('Load failed', `${description} (${code})\n${url}`);
  });

  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    dialog.showErrorBox('Preload failed', `${preloadPath}\n${error?.message || error}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * "Order History" lives in the native View menu (not a header button in the
 * POS screen itself) - the click handler tells the renderer to navigate via
 * the same webContents.send()/desktopPos.on() event pattern the sync-status
 * broadcast already uses, since a menu click only ever runs in the main
 * process.
 */
function buildAppMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Order History',
          accelerator: 'CmdOrCtrl+H',
          click: () => mainWindow?.webContents.send('navigate', '/orders'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  try {
    await initDatabase();
    registerIpcHandlers();
    startSyncScheduler(() => mainWindow);
    buildAppMenu();
    createWindow();
  } catch (error) {
    dialog.showErrorBox('ERP Desktop POS', error?.message || 'Failed to start application.');
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});
