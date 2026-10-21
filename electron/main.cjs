const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('node:path');
const os = require('node:os');

// Dedicated userData directory in temp to avoid any Windows cache lock
app.setPath('userData', path.join(os.tmpdir(), 'pocket-corner-overlay-v2'));

let overlayWin = null;
const WIDGET_WIDTH = 360;
const WIDGET_HEIGHT = 180;

function getTargetUrl() {
  return process.env.POCKET_URL || 'http://localhost:5174/?desktop=1';
}

function positionAboveTaskbar(win, corner = 'bottom-right') {
  const primaryDisplay = screen.getPrimaryDisplay();
  // workArea excludes the Windows taskbar automatically, so y + height is the exact top of the taskbar!
  const { x, y, width, height } = primaryDisplay.workArea;

  let targetX = x + width - WIDGET_WIDTH - 16;
  if (corner === 'bottom-left') {
    targetX = x + 16;
  } else if (corner === 'bottom-center') {
    targetX = x + Math.round((width - WIDGET_WIDTH) / 2);
  }
  const targetY = y + height - WIDGET_HEIGHT;

  win.setBounds({
    x: targetX,
    y: targetY,
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
  });
}

function createOverlayWindow() {
  overlayWin = new BrowserWindow({
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    thickFrame: false,
    skipTaskbar: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWin.setMenuBarVisibility(false);
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  positionAboveTaskbar(overlayWin, 'bottom-right');

  const url = getTargetUrl();
  overlayWin.loadURL(url).catch(() => {
    overlayWin.loadURL('http://localhost:5173/?desktop=1').catch(() => {
      overlayWin.loadURL('http://localhost:3001/?desktop=1');
    });
  });

  overlayWin.on('closed', () => {
    overlayWin = null;
  });
}

ipcMain.on('pocket:set-ignore-mouse', (_event, ignore) => {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  if (ignore) {
    overlayWin.setIgnoreMouseEvents(true, { forward: true });
  } else {
    overlayWin.setIgnoreMouseEvents(false);
  }
});

let currentCorner = 'bottom-right';

ipcMain.on('pocket:dock-corner', (_event, corner) => {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  currentCorner = corner;
  positionAboveTaskbar(overlayWin, corner);
});

ipcMain.on('pocket:set-popup-expanded', (_event, expanded) => {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  if (expanded) {
    overlayWin.setIgnoreMouseEvents(false);
    const primaryDisplay = screen.getPrimaryDisplay();
    const { x, y, width, height } = primaryDisplay.workArea;
    const popW = Math.min(780, width - 32);
    const popH = Math.min(560, height - 32);
    overlayWin.setBounds({
      x: x + Math.round((width - popW) / 2),
      y: y + Math.round((height - popH) / 2),
      width: popW,
      height: popH,
    });
  } else {
    positionAboveTaskbar(overlayWin, currentCorner);
  }
});

ipcMain.on('pocket:open-hub', () => {
  const baseUrl = getTargetUrl().replace(/\?.*$/, '');
  shell.openExternal(baseUrl);
});

ipcMain.on('pocket:close', () => {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.close();
  }
});

app.whenReady().then(() => {
  // Small delay on Windows ensures DWM transparency initializes cleanly
  setTimeout(createOverlayWindow, 150);
});

app.on('window-all-closed', () => {
  app.quit();
});
