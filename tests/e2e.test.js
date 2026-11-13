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
  await p.waitForSelector('.node'); await p.click('#ctlEdit');
  const before = await p.evaluate("({ links: ctlL().links.length, parts: ctlL().parts.length, y: ctlL().parts.find(q => q.key === 'anteilb').y })");
  const bb = await p.locator('.node:has-text("Anteil B") .nh').boundingBox();
  await p.mouse.move(bb.x + 40, bb.y + 10); await p.mouse.down(); await p.mouse.move(bb.x + 40, bb.y + 130, { steps: 5 }); await p.mouse.up();
  await p.locator('.node:has-text("Anteil B") button:has-text("Verbinden")').click();
  await p.locator('.node:has-text("Pumpe (Fluss gesamt)") .nn').click();
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

test('A-59 / A-60 / A-63 / A-65 Ablauf, „Alles stopp“, Sperre im Methodenlauf, Lecksensor, Neuanmeldung', async () => {
  const o = await open('#steuerung'), p = o.page;
  await p.waitForSelector('.node'); await p.evaluate('S.dev.speed = 1');
  await p.locator('.node:has-text("Säulenheizung") button:has-text("An")').click();
  await p.click('#prStart'); await p.waitForFunction('CTL.run && CTL.run.idx >= 3', null, { timeout: 20000 });
  await p.click('#ctlStopAll');
  let r = await p.evaluate("({ run: CTL.run, flow: S.dev.flowSet, heat: CTL.values.heizung, valve: CTL.values.inj, audit: S.auditLog.some(a => a.action === 'stop all') })");
  assert.equal(r.run, null); assert.equal(r.flow, 0); assert.equal(r.heat, '0'); assert.equal(r.valve, 'LOAD'); assert.ok(r.audit);
  /* Sperre: während eines Methodenlaufs sendet die Steuerung nichts */
  await p.evaluate("location.hash = '#messen'"); await p.click('#btnStart'); await p.waitForFunction("S.phase !== 'idle'");
  assert.equal(await p.evaluate("ctlSend(ctlL().parts.find(q => q.key === 'heizung'), 40)"), false, 'A-60 Steuerung ist gesperrt');
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
  await p.waitForSelector('.node');
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
