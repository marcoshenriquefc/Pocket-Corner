const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pocketDesktop', {
  isDesktopOverlay: true,
  setIgnoreCursorEvents: (ignore) => {
    ipcRenderer.send('pocket:set-ignore-mouse', Boolean(ignore));
  },
  dockToCorner: (corner) => {
    ipcRenderer.send('pocket:dock-corner', corner);
  },
  setPopupExpanded: (expanded) => {
    ipcRenderer.send('pocket:set-popup-expanded', Boolean(expanded));
  },
  openFullHub: () => {
    ipcRenderer.send('pocket:open-hub');
  },
  closeOverlay: () => {
    ipcRenderer.send('pocket:close');
  },
});
