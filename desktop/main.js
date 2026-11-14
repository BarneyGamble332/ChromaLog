'use strict';
/*
 * ChromaLog für Linux: zeigt die Web-App in einem eigenen Fenster.
 * Der Unterschied zum Browser: Die Auswahl des seriellen Anschlusses und des Bluetooth-Geräts
 * übernimmt dieses Programm, und die Daten liegen im Benutzerordner statt im Browser-Profil.
 */
const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const path = require('path');
let win = null, btCallback = null, btDevices = [], btTimer = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 420, minHeight: 500, title: 'ChromaLog', backgroundColor: '#edf0f4',
    icon: path.join(__dirname, 'build', 'icon-512.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  const ses = win.webContents.session;

  /* Serieller Anschluss (Arduino): Liste anzeigen und wählen lassen */
  ses.on('select-serial-port', async (event, portList, webContents, callback) => {
    event.preventDefault();
    if (!portList.length) {
      await dialog.showMessageBox(win, { type: 'warning', title: 'ChromaLog', message: 'Kein serieller Anschluss gefunden.',
        detail: 'Ist der Arduino angesteckt? Unter Linux muss der Benutzer außerdem in der Gruppe „dialout“ sein:\nsudo usermod -a -G dialout $USER  (danach neu anmelden)' });
      callback(''); return;
    }
    const labels = portList.map(p => (p.displayName || p.portName || p.portId) + (p.vendorId ? '  [' + p.vendorId + ':' + p.productId + ']' : ''));
    const r = await dialog.showMessageBox(win, { type: 'question', title: 'ChromaLog', message: 'Anschluss wählen', buttons: labels.concat('Abbrechen'), cancelId: labels.length, defaultId: 0 });
    callback(r.response < labels.length ? portList[r.response].portId : '');
  });
  ses.setPermissionCheckHandler((wc, permission) => permission === 'serial' || permission === 'bluetooth' || permission === 'clipboard-sanitized-write' || permission === 'fullscreen');
  ses.setDevicePermissionHandler(details => details.deviceType === 'serial');

  /* Bluetooth: 4 Sekunden suchen, dann die gefundenen Geräte zur Auswahl anbieten */
  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    btCallback = callback; btDevices = devices;
    if (btTimer) return;
    btTimer = setTimeout(async () => {
      btTimer = null; const cb = btCallback, list = btDevices; btCallback = null;
      if (!list.length) { await dialog.showMessageBox(win, { type: 'warning', title: 'ChromaLog', message: 'Kein Bluetooth-Gerät gefunden.' }); cb(''); return; }
      const labels = list.map(d => d.deviceName || d.deviceId);
      const r = await dialog.showMessageBox(win, { type: 'question', title: 'ChromaLog', message: 'Bluetooth-Gerät wählen', buttons: labels.concat('Abbrechen'), cancelId: labels.length, defaultId: 0 });
      cb(r.response < labels.length ? list[r.response].deviceId : '');
    }, 4000);
  });

  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.on('closed', () => { win = null; });
  /* Selbsttest für den automatischen Bau: CHROMALOG_SMOKE=1 startet, prüft die App und beendet sich */
  if (process.env.CHROMALOG_SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      const probe = "JSON.stringify({ runs: S.runs.length, device: S.dev && S.dev.kind, data: !!S.last, peaks: S.runs.length ? S.runs[0].analysis.peaks.length : 0, persistent: Store.persistent, serial: 'serial' in navigator, bluetooth: 'bluetooth' in navigator, version: APP_VERSION })";
      let r = '{}';
      for (let i = 0; i < 40; i++) {                       /* bis zu 40 s warten: der erste Start legt den Beispiel-Lauf an */
        await new Promise(res => setTimeout(res, 1000));
        try { r = await win.webContents.executeJavaScript(probe); } catch (e) { r = JSON.stringify({ error: String(e) }); }
        if (/"runs":[1-9]/.test(r) && /"data":true/.test(r)) break;
      }
      console.log('SMOKE ' + r); app.exit(/"runs":[1-9]/.test(r) && /"data":true/.test(r) ? 0 : 1);
    });
  }
}

app.commandLine.appendSwitch('enable-experimental-web-platform-features');   /* schaltet Web Bluetooth unter Linux frei */
Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'Datei', submenu: [{ label: 'Drucken …', accelerator: 'CmdOrCtrl+P', click: () => win && win.webContents.print() }, { type: 'separator' }, { label: 'Beenden', role: 'quit' }] },
  { label: 'Ansicht', submenu: [{ label: 'Neu laden', role: 'reload' }, { label: 'Vollbild', role: 'togglefullscreen' }, { type: 'separator' },
    { label: 'Größer', role: 'zoomIn' }, { label: 'Kleiner', role: 'zoomOut' }, { label: 'Normale Größe', role: 'resetZoom' }, { type: 'separator' }, { label: 'Entwicklerwerkzeuge', role: 'toggleDevTools' }] }
]));
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
