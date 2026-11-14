'use strict';
/*
 * Tests der Oberfläche im Browser mit dem Simulator (Playwright, Chromium).
 * Start: npm run test:ui   ·  lokal mit installiertem Chrome: PW_CHANNEL=chrome npm run test:ui
 * Jeder Test trägt die Nummer der Anforderung aus docs/ANFORDERUNGEN.md.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { chromium } = require('playwright');

const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
let browser;
test.before(async () => { browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--no-sandbox'] }); });
test.after(async () => { await browser.close(); });

/* Jede Prüfung beginnt mit leerem Speicher in einem eigenen Browser-Profil */
async function open(hash) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, locale: 'de-DE' });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL + (hash || ''));
  await page.waitForFunction("typeof S !== 'undefined' && S.dev && S.last && S.runs.length > 0");
  await page.evaluate('S.dev.speed = 60');
  return { ctx, page, errors };
}
const done = async (o) => { assert.deepEqual(o.errors, [], 'keine Fehler in der Browser-Konsole'); await o.ctx.close(); };

test('A-04 Lauf im Simulator: Equilibrieren, Injektion, Ende, Speicherung, Auswertung', async () => {
  const o = await open('#messen'), p = o.page;
  await p.fill('#inName', 'Testlauf'); await p.click('#btnStart');
  await p.waitForFunction("location.hash === '#auswertung'", null, { timeout: 60000 });
  const r = await p.evaluate("({ n: S.runs.length, name: S.runs[0].name, pts: S.runs[0].data.t.length, end: S.runs[0].data.t.at(-1), peaks: S.aRes.peaks.map(q => q.name), hash: S.runs[0].hash.length, phase: S.phase, method: !!S.runs[0].method.gradient })");
  assert.equal(r.n, 2); assert.equal(r.name, 'Testlauf'); assert.equal(r.phase, 'idle');
  assert.ok(r.pts > 8000 && Math.abs(r.end - 14) < 0.05, 'Lauf dauert 14 min bei 10 Hz');
  assert.deepEqual(r.peaks.filter(Boolean), ['Koffein', 'Benzotriazol', 'Carbamazepin', 'Diclofenac']);
  assert.equal(r.hash, 64, 'A-40 Prüfsumme vorhanden'); assert.ok(r.method, 'A-41 Methode am Lauf gespeichert');
  await done(o);
});

test('A-05 Überdruck bricht den Lauf ab und stoppt die Pumpen (im Lauf und beim Equilibrieren)', async () => {
  const o = await open('#messen'), p = o.page;
  await p.click('#btnStart');
  await p.waitForFunction("S.phase === 'run' && S.run.data.t.length > 200", null, { timeout: 30000 });
  await p.evaluate('S.run.method.pmax = 3');                       /* Simulator liefert rund 6 bar */
  await p.waitForFunction("S.runs.length === 2 && S.phase === 'idle'", null, { timeout: 30000 });
  const r = await p.evaluate("({ aborted: S.runs[0].aborted, reason: S.runs[0].reason, flow: S.dev.flowSet })");
  assert.equal(r.aborted, true); assert.equal(r.reason, 'overpressure'); assert.equal(r.flow, 0);
  await p.evaluate("location.hash = '#messen'; S.dev.send('FLOW 1'); S.methods[0].pmax = 3"); await p.waitForFunction('S.last.press > 5', null, { timeout: 20000 });
  await p.click('#btnStart'); await p.waitForFunction("S.phase === 'idle' && S.dev.flowSet === 0", null, { timeout: 20000 });
  assert.equal(await p.evaluate('S.runs.length'), 2, 'beim Equilibrieren abgebrochen: kein neuer Lauf');
  await done(o);
});

test('A-08 Sequenz arbeitet die Probenliste ab und fragt vor jeder Probe', async () => {
  const o = await open('#sequenz'), p = o.page;
  await p.click('#qAdd'); await p.click('#qAdd'); await p.click('#qStart');
  for (let i = 0; i < 2; i++) { await p.waitForSelector('#dlg[open]', { timeout: 60000 }); await p.waitForTimeout(150); await p.click('#dlgYes'); await p.waitForTimeout(300); }
  await p.waitForFunction('!S.seq.running', null, { timeout: 60000 });
  assert.deepEqual(await p.evaluate("S.seq.rows.map(r => r.status)"), ['done', 'done']);
  assert.equal(await p.evaluate('S.runs.length'), 3);
  await done(o);
});

test('A-23 / A-42 Kalibrierung, Quantifizierung, Verfall bei geänderter Methode, Speichern der Auswertung', async () => {
  const o = await open('#kalibrierung'), p = o.page;
  await p.click('#cExample'); await p.waitForFunction('S.runs.length === 4'); await p.click('#cSave');
  await p.evaluate("location.hash = '#auswertung'"); await p.waitForTimeout(200);
  await p.selectOption('#aSel', await p.evaluate("S.runs.find(r => r.type === 'sample').id")); await p.waitForTimeout(300);
  const conc = await p.evaluate("S.aRes.peaks.filter(q => q.name).map(q => concOf(S.aRun, q).v)");
  assert.equal(conc.length, 4); conc.forEach(v => assert.ok(v > 0.3 && v < 5, 'Konzentration plausibel: ' + v));
  await p.locator('button[data-rmpk="0"]').click(); await p.click('#aSave');
  await p.waitForFunction("S.auditLog.some(a => a.action === 'analysis saved')"); await p.waitForTimeout(300); await p.reload();
  await p.waitForFunction("typeof S !== 'undefined' && S.runs.length === 4 && S.aRun"); 
  await p.selectOption('#aSel', await p.evaluate("S.runs.find(r => r.type === 'sample').id")); await p.waitForTimeout(300);
  assert.equal(await p.evaluate('S.aEdits.removed.length'), 1, 'A-42 manuelle Änderung bleibt nach dem Neuladen erhalten');
  await p.evaluate("location.hash = '#methoden'"); await p.waitForTimeout(200);
  await p.fill('#mEditor input[data-f="flow"]', '0.8'); await p.click('#mSave'); await p.waitForTimeout(200);
  assert.equal(await p.evaluate('String(S.methods[0].calibration)'), 'undefined', 'A-23 Kalibrierung verfällt');
  await done(o);
});

test('A-44 Messbericht enthält alle Teile und kennzeichnet simulierte Daten', async () => {
  const o = await open('#auswertung'), p = o.page;
  await p.waitForFunction("S.aRun && S.aHash !== 'unknown'"); await p.click('#aReport'); await p.waitForSelector('#report h1');
  const txt = await p.textContent('#report');
  for (const w of ['Messbericht', 'Simulierte Daten', 'Methode', 'Chromatogramm', 'Ergebnis', 'Kalibrierung', 'Prüfsumme Rohdaten', 'stimmt', 'Software-Version', 'Unterschrift']) assert.ok(txt.includes(w), 'Bericht enthält „' + w + '“');
  assert.ok((await p.getAttribute('#report img', 'src')).startsWith('data:image/png'), 'Chromatogramm ist als Bild enthalten');
  await done(o);
});

test('A-47 Veränderte Rohdaten werden beim Import und beim Öffnen erkannt', async () => {
  const o = await open('#laeufe'), p = o.page;
  const run = await p.evaluate('JSON.parse(JSON.stringify(S.runs[0]))');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromalog-'));
  const good = path.join(dir, 'ok.json'), bad = path.join(dir, 'veraendert.json');
  fs.writeFileSync(good, JSON.stringify(run));
  run.data.uv[4000] += 25; run.name = 'manipuliert'; fs.writeFileSync(bad, JSON.stringify(run));
  await p.setInputFiles('#runFile', good); await p.waitForFunction("S.runs.length === 2 && S.auditLog.some(a => a.action === 'run imported')"); await p.waitForTimeout(300);
  assert.equal(await p.evaluate('!!S.runs[0].hashMismatch'), false, 'unveränderte Datei wird angenommen');
  await p.setInputFiles('#runFile', bad); await p.waitForFunction('S.runs.length === 3 && S.runs[0].hashMismatch === true', null, { timeout: 10000 });
  assert.equal(await p.evaluate('S.runs[0].hashMismatch'), true, 'veränderte Datei wird markiert');
  await p.evaluate("openAnalysis(S.runs[0].id)"); await p.waitForFunction("S.aHash === 'bad'");
  await p.evaluate("openAnalysis(S.runs[1].id)"); await p.waitForFunction("S.aHash === 'ok'");
  /* Veränderung im Speicher ohne Import */
  await p.evaluate("S.runs[2].data.uv[10] += 1; openAnalysis(S.runs[2].id)"); await p.waitForFunction("S.aHash === 'bad'");
  assert.ok(await p.evaluate("S.auditLog.some(a => a.action.startsWith('checksum mismatch'))"), 'steht im Protokoll');
  await done(o);
});

test('A-58 Fließbild: verschieben, verbinden, Bauteil anlegen, Leitung löschen, bleibt erhalten', async () => {
  const o = await open('#steuerung'), p = o.page;
  await p.waitForSelector('#flowInner .node'); await p.click('#ctlEdit');
  const before = await p.evaluate("({ links: ctlL().links.length, parts: ctlL().parts.length, y: ctlL().parts.find(q => q.key === 'anteilb').y })");
  const bb = await p.locator('#flowInner .node:has-text("Anteil B") .nh').boundingBox();
  await p.mouse.move(bb.x + 40, bb.y + 10); await p.mouse.down(); await p.mouse.move(bb.x + 40, bb.y + 130, { steps: 5 }); await p.mouse.up();
  await p.locator('#flowInner .node:has-text("Anteil B") button:has-text("Verbinden")').click();
  await p.locator('#flowInner .node:has-text("Pumpe (Fluss gesamt)") .nn').click();
  await p.click('#ctlAdd'); await p.locator('#libDlg button[data-lib="leak"]').click(); await p.locator('#partDlg button[data-x="ok"]').click();
  let a = await p.evaluate("({ links: ctlL().links.length, parts: ctlL().parts.length, y: ctlL().parts.find(q => q.key === 'anteilb').y, cfg: S.console.filter(l => l.includes('CFG leck')).pop() })");
  assert.equal(a.links, before.links + 1); assert.equal(a.parts, before.parts + 1); assert.equal(a.y, before.y + 120); assert.equal(a.cfg, '> CFG leck LIMIT 13 ALL 0');
  const pt = await p.evaluate(`(() => { const r = document.querySelector('#flowSvg').getBoundingClientRect();
    for (const h of document.querySelectorAll('#flowSvg path.hit')) { const q = h.getPointAtLength(h.getTotalLength() / 2), x = r.x + q.x, y = r.y + q.y; if (document.elementFromPoint(x, y) === h) return [x, y]; }
    return null; })()`);
  assert.ok(pt, 'eine frei liegende Leitung gefunden');
  await p.mouse.click(pt[0], pt[1]);
  assert.equal(await p.evaluate('ctlL().links.length'), before.links, 'Klick auf die Leitung löscht sie');
  await p.reload(); await p.waitForFunction("typeof CTL !== 'undefined' && CTL.layouts.length");
  assert.equal(await p.evaluate('ctlL().parts.length'), before.parts + 1, 'Aufbau bleibt nach dem Neuladen erhalten');
  await done(o);
});

test('A-59 / A-60 / A-63 / A-65 / A-74 Bedienfenster, Ablauf, „Alles stopp“, Sperre im Methodenlauf, Lecksensor, Neuanmeldung', async () => {
  const o = await open('#steuerung'), p = o.page;
  await p.waitForSelector('#flowInner .node'); await p.evaluate('S.dev.speed = 1');
  /* A-74: Bauteil im Fließbild anklicken öffnet das Bedienfenster */
  assert.equal(await p.evaluate("document.querySelectorAll('#flowInner .node button').length"), 0, 'im Fließbild selbst gibt es keine Bedienknöpfe');
  await p.locator('#flowInner .node:has-text("Säulenheizung")').click(); await p.waitForSelector('#opDlg[open]');
  assert.ok(await p.evaluate("document.querySelector('#flowInner .node.sel .nn').textContent.includes('Säulenheizung')"), 'gewähltes Bauteil ist markiert');
  await p.fill('#opBody input[data-role="value"]', '45'); await p.locator('#opBody button:has-text("An")').click();
  assert.equal(await p.evaluate('CTL.values.heizung'), 45);
  await p.waitForFunction("document.querySelector('#opBody [data-live]').textContent !== '–'", null, { timeout: 10000 });
  await p.click('#opClose'); await p.waitForFunction("!document.querySelector('#opDlg').open && !document.querySelector('#flowInner .node.sel')");
  assert.ok(await p.evaluate("document.querySelector('#flowInner .node[data-id=\"' + ctlL().parts.find(q => q.key === 'heizung').id + '\"] .state').textContent.includes('45')"), 'Kachel zeigt den neuen Sollwert');
  await p.locator('#flowInner .node:has-text("Drucksensor")').click(); assert.equal(await p.evaluate("document.querySelector('#opDlg').open"), false, 'reine Anzeigen öffnen kein Fenster');
  await p.click('#prStart'); await p.waitForFunction('CTL.run && CTL.run.idx >= 3', null, { timeout: 20000 });
  await p.click('#ctlStopAll');
  let r = await p.evaluate("({ run: CTL.run, flow: S.dev.flowSet, heat: CTL.values.heizung, valve: CTL.values.inj, audit: S.auditLog.some(a => a.action === 'stop all') })");
  assert.equal(r.run, null); assert.equal(r.flow, 0); assert.equal(r.heat, '0'); assert.equal(r.valve, 'LOAD'); assert.ok(r.audit);
  /* Sperre: während eines Methodenlaufs sendet die Steuerung nichts */
  await p.evaluate("location.hash = '#messen'"); await p.click('#btnStart'); await p.waitForFunction("S.phase !== 'idle'");
  assert.equal(await p.evaluate("ctlSend(ctlL().parts.find(q => q.key === 'fluss'), 0.2)"), false, 'A-60 von der Methode gefahrenes Bauteil ist gesperrt');
  assert.equal(await p.evaluate("ctlSend(ctlL().parts.find(q => q.key === 'heizung'), 40)"), true, 'A-60 andere Bauteile bleiben im Lauf bedienbar');
  assert.ok(await p.evaluate("document.querySelector('#mParts .node.locked .nn').textContent.includes('Pumpe')"), 'gesperrte Kachel ist im Reiter Messen gekennzeichnet');
  await p.evaluate('ctlStopAll()'); await p.waitForFunction("S.phase === 'idle'");
  assert.equal(await p.evaluate('S.dev.flowSet'), 0, 'A-60 „Alles stopp“ bricht auch den Methodenlauf ab');
  /* A-63: Meldung des Lecksensors vom Gerät löst „Alles stopp“ in der App aus */
  await p.evaluate("S.dev.send('FLOW 1'); CTL.values.heizung = 40; onLine('E,STOP,leck')");
  const e = await p.evaluate("({ flow: S.dev.flowSet, heat: CTL.values.heizung, audit: S.auditLog.some(a => a.action === 'stop all' && a.detail.includes('leck')) })");
  assert.equal(e.flow, 0); assert.equal(e.heat, '0'); assert.ok(e.audit, 'steht mit dem Namen des Sensors im Protokoll');
  /* A-65: nach dem Neustart des Arduino werden die Bauteile neu angemeldet */
  await p.evaluate("window.sent = []; const send = S.dev.send.bind(S.dev); S.dev.send = c => { window.sent.push(c); send(c); }; onLine('READY ChromaLog-Uno 0.2')");
  const sent = await p.evaluate('window.sent');
  assert.ok(sent.indexOf('CLEAR') >= 0 && sent.indexOf('CFG heizung HEATER 8/12') > sent.indexOf('CLEAR') && sent.includes('WATCHDOG 10'), 'CLEAR, CFG und WATCHDOG nach READY: ' + sent.join(' | '));
  await done(o);
});

test('A-67 Methodenlauf fährt die Bauteile mit Rolle (Pumpe A/B, Injektionsventil)', async () => {
  const o = await open('#steuerung'), p = o.page;
  await p.waitForSelector('#flowInner .node');
  await p.evaluate(`(() => { const L = ctlL(); const mk = (lib, key, role) => { const q = ctlMake(lib, 40, 600); q.key = key; q.role = role; L.parts.push(q); };
    mk('syringe', 'pa', 'pumpA'); mk('syringe', 'pb', 'pumpB'); mk('hahn3', 'iv', 'inj'); ctlConfigure(true);
    window.sent = []; const send = S.dev.send.bind(S.dev); S.dev.send = c => { window.sent.push(c); send(c); }; })()`);
  await p.evaluate("location.hash = '#messen'"); await p.click('#btnStart');
  await p.waitForFunction("S.phase === 'run' && S.run.data.t.at(-1) > 5", null, { timeout: 60000 });
  const c = await p.evaluate('window.sent');
  assert.ok(c.includes('SET pa 0.95') && c.includes('SET pb 0.05'), 'Start mit 5 % B: A 0,95 und B 0,05 ml/min');
  assert.ok(c.indexOf('SET iv 20') >= 0 && c.indexOf('SET iv 110') > c.indexOf('SET iv 20'), 'Ventil: erst Laden (20), dann Injizieren (110)');
  const last = c.filter(l => l.startsWith('SET pb')).pop(); assert.ok(parseFloat(last.split(' ').pop()) > 0.3, 'Anteil B steigt im Gradienten: ' + last);
  const sum = parseFloat(c.filter(l => l.startsWith('SET pa')).pop().split(' ').pop()) + parseFloat(last.split(' ').pop()); assert.ok(Math.abs(sum - 1) < 0.002, 'A + B ergeben den Gesamtfluss: ' + sum);
  assert.ok(!c.some(l => l.startsWith('PCTB') || l.startsWith('FLOW')), 'keine unveränderten Methodenbefehle mehr');
  await p.click('#btnAbort'); await done(o);
});

test('A-73 Bauteile des Aufbaus erscheinen im Reiter „Messen“ und lassen sich dort bedienen', async () => {
  const o = await open('#messen'), p = o.page;
  await p.waitForSelector('#mParts .node');
  assert.equal(await p.evaluate("document.querySelectorAll('#mParts .node').length"), await p.evaluate('ctlL().parts.length'), 'alle Bauteile des Aufbaus');
  assert.equal(await p.evaluate("document.querySelector('#manCard').hidden"), true, 'feste Handsteuerung ist dann ausgeblendet');
  await p.locator('#mParts .node:has-text("Säulenheizung") button:has-text("An")').click();
  await p.locator('#mParts .node:has-text("Injektionsventil") button:has-text("Injizieren")').click();
  await p.waitForFunction("S.last.valve === 'INJECT' && CTL.meas.heizung > 22.2", null, { timeout: 20000 });
  assert.equal(await p.evaluate('CTL.values.heizung'), 40);
  assert.ok(await p.evaluate("document.querySelector('#mParts .node:nth-child(3) [data-live]').textContent !== '–'"), 'Messwerte laufen mit');
  /* Bauteil ausblenden, anderer Aufbau, leerer Aufbau */
  await p.evaluate("ctlL().parts.find(q => q.key === 'heizung').onMess = false; ctlRenderNodes()");
  assert.equal(await p.evaluate("document.querySelectorAll('#mParts .node').length"), await p.evaluate('ctlL().parts.length - 1'), 'ausgeblendetes Bauteil fehlt');
  await p.evaluate("location.hash = '#steuerung'"); await p.selectOption('#ctlSel', { label: 'Stufe 1 – UV-Detektor' }); await p.evaluate("location.hash = '#messen'");
  assert.equal(await p.evaluate("document.querySelectorAll('#mParts .node').length"), 4, 'Reiter Messen folgt dem gewählten Aufbau');
  await p.evaluate("ctlL().parts.length = 0; ctlRenderNodes()");
  assert.equal(await p.evaluate("document.querySelector('#mpCard').hidden && !document.querySelector('#manCard').hidden"), true, 'ohne Bauteile erscheint wieder die Handsteuerung');
  await p.click('#mpStop', { force: true }).catch(() => {});
  await done(o);
});

/* Nachgebildete Capacitor-Brücke: prüft, dass die App die Plugins so anspricht, wie deren Schnittstelle es vorsieht.
   Das ersetzt keinen Test auf einem echten Handy. */
const FAKE_CAPACITOR = `window.fake = { calls: [], read: null, notify: null, files: [] };
window.Capacitor = { isNativePlatform: () => true,
  nativePromise: (plugin, method, o) => { fake.calls.push(plugin + '.' + method + ' ' + JSON.stringify(o));
    if (method === 'requestSerialPermissions') return fake.noDevice ? Promise.reject('NO_DEVICE_ERROR') : Promise.resolve({ granted: true });
    if (method === 'requestDevice') return Promise.resolve({ deviceId: 'AA:BB', name: 'HMSoft' });
    if (method === 'getServices') return Promise.resolve({ services: [{ uuid: '0000FFE0-0000-1000-8000-00805F9B34FB' }] });
    if (method === 'writeFile') { if (o.directory === 'DOCUMENTS' && fake.noDocuments) return Promise.reject('denied'); fake.files.push(o); return Promise.resolve({ uri: 'file:///cache/' + o.path }); }
    return Promise.resolve({}); },
  nativeCallback: (plugin, method, o, cb) => { fake.calls.push(plugin + '.' + method + ' ' + JSON.stringify(o));
    if (method === 'registerReadCallback') fake.read = cb; if (method === 'addListener' && o.eventName.startsWith('notification|')) fake.notify = cb; } };`;
async function openNative() {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, locale: 'de-DE' }); await ctx.addInitScript(FAKE_CAPACITOR);
  const page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL + '#system'); await page.waitForFunction("typeof S !== 'undefined' && S.dev && S.last");
  return { ctx, page, errors };
}

test('A-06 Android-App: USB über das Serial-Plugin (nachgebildete Brücke)', async () => {
  const o = await openNative(), p = o.page;
  assert.ok(await p.evaluate("fake.calls.some(c => c.startsWith('KeepAwake.keepAwake'))"), 'Bildschirm bleibt an');
  await p.selectOption('#selTr', 'usb'); await p.click('#btnConnect'); await p.waitForFunction("S.dev && S.dev.kind === 'usb'");
  let c = await p.evaluate('fake.calls');
  assert.ok(c.some(q => q.startsWith('Serial.openConnection') && q.includes('"baudRate":115200') && q.includes('"dtr":true')), 'öffnet mit 115200 Baud und DTR');
  await p.evaluate("fake.read({ data: 'READY ChromaLog-Uno 0.2\\nD,5.0,0.0125' }); fake.read({ data: '00,,,23.10,,,\\nV,heizung,31.5\\n' })");
  const r = await p.evaluate("({ uv: S.last.uv, temp: S.last.temp, heat: CTL.meas.heizung })");
  assert.equal(r.uv, 12.5); assert.equal(r.temp, 23.1); assert.equal(r.heat, 31.5);
  c = await p.evaluate("fake.calls.filter(q => q.startsWith('Serial.write')).map(q => JSON.parse(q.slice(13)).data)");
  assert.ok(c.includes('CLEAR\n') && c.includes('CFG heizung HEATER 8/12\n') && c.includes('WATCHDOG 10\n'), 'nach READY: CLEAR, CFG, WATCHDOG mit Zeilenende');
  await p.evaluate("fake.read(null, 'CONNECTION_ERROR')"); await p.waitForFunction('S.dev === null');
  await p.evaluate('fake.noDevice = true'); await p.click('#btnConnect'); await p.waitForFunction("document.querySelector('#connHint').textContent.includes('OTG')");
  assert.deepEqual(o.errors, []); await o.ctx.close();
});

test('A-07 Android-App: Bluetooth über das BLE-Plugin, Dateien speichern (nachgebildete Brücke)', async () => {
  const o = await openNative(), p = o.page;
  await p.selectOption('#selTr', 'ble'); await p.click('#btnConnect'); await p.waitForFunction("S.dev && S.dev.kind === 'ble'");
  const svc = '0000ffe0-0000-1000-8000-00805f9b34fb', chr = '0000ffe1-0000-1000-8000-00805f9b34fb';
  let c = await p.evaluate('fake.calls');
  assert.ok(c.some(q => q.startsWith('BluetoothLe.startNotifications') && q.includes(svc) && q.includes(chr)), 'HM-10-Profil wird an den gemeldeten Diensten erkannt');
  await p.evaluate("fake.notify({ value: '442c372e302c302e3030352c2c2c32312e30' }); fake.notify({ value: '2c 2c 2c 0a' })");          /* "D,7.0,0.005,,,21.0" + ",,,\n" */
  assert.equal(await p.evaluate('S.last.uv'), 5); assert.equal(await p.evaluate('S.last.temp'), 21);
  await p.evaluate("cmd('SET heizung 40 und noch etwas Text')");
  await p.waitForFunction("fake.calls.filter(q => q.startsWith('BluetoothLe.writeWithoutResponse')).length >= 2");
  const w = await p.evaluate("fake.calls.filter(q => q.startsWith('BluetoothLe.writeWithoutResponse')).map(q => JSON.parse(q.slice(q.indexOf(' ') + 1)).value)");
  const text = Buffer.from(w.join(''), 'hex').toString();
  assert.ok(text.endsWith('SET heizung 40 und noch etwas Text\n'), 'Befehl kommt vollständig an: ' + text); assert.ok(w.every(h => h.length <= 40), 'höchstens 20 Byte je Paket');
  /* Dateien: erst Dokumente, sonst Teilen */
  assert.equal(await p.evaluate("saveFile('lauf.csv', 'a,b')"), true);
  assert.deepEqual(await p.evaluate('fake.files.map(f => f.directory + ":" + f.path)'), ['DOCUMENTS:ChromaLog/lauf.csv']);
  await p.evaluate('fake.noDocuments = true'); assert.equal(await p.evaluate("saveFile('lauf2.csv', 'a,b')"), true);
  assert.ok(await p.evaluate("fake.calls.some(q => q.startsWith('Share.share') && q.includes('file:///cache/lauf2.csv'))"), 'Ausweg über „Teilen“');
  assert.deepEqual(o.errors, []); await o.ctx.close();
});
