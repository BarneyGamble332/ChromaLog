'use strict';
/* ChromaLog – Ablaufsteuerung und Oberfläche */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const CH = ['uv', 'cond', 'press', 'temp', 'flow', 'b'];
const APP_VERSION = '0.9';

const DEFAULT_METHODS = [
  { id: 'm-screening', name: 'Abwasser-Screening (Gradient)', column: 'C18, 100 × 4,6 mm', solventA: 'Wasser + 0,1 % Ameisensäure', solventB: 'Acetonitril',
    flow: 1.0, runtime: 14, rate: 10, pmax: 10, autozero: true,
    gradient: [{ t: 0, b: 5 }, { t: 1, b: 5 }, { t: 9, b: 95 }, { t: 11, b: 95 }, { t: 11.2, b: 5 }, { t: 14, b: 5 }],
    events: [{ t: 13.5, pos: 'LOAD' }],
    compounds: [{ name: 'Koffein', rt: 3.24, tol: 0.25 }, { name: 'Benzotriazol', rt: 4.60, tol: 0.25 }, { name: 'Carbamazepin', rt: 6.30, tol: 0.25 }, { name: 'Diclofenac', rt: 7.79, tol: 0.25 }] },
  { id: 'm-koffein', name: 'Koffein isokratisch', column: 'C18, 100 × 4,6 mm', solventA: 'Wasser', solventB: 'Acetonitril',
    flow: 1.0, runtime: 8, rate: 10, pmax: 10, autozero: true,
    gradient: [{ t: 0, b: 20 }, { t: 8, b: 20 }], events: [],
    compounds: [{ name: 'Koffein', rt: 2.30, tol: 0.3 }, { name: 'Benzotriazol', rt: 5.28, tol: 0.4 }] }
];

const S = {
  methods: [], runs: [], auditLog: [], dev: null, last: null, stage1: false, led: true,
  mon: { t: [], uv: [], cond: [], press: [], temp: [], b: [] }, phase: 'idle', run: null,
  view: { auto: true }, aView: { auto: true }, aRun: null, aRes: null, editM: null, editDirty: false,
  console: [], dirty: true, tab: 'messen', mstate: { flow: 0, b: 0 }, lastPing: 0, aHash: 'unknown', cal: { excluded: {}, sel: null, res: null }, aEdits: { manual: [], removed: [] }, aOverlay: [], aManualMode: false, seq: { rows: [], running: false, idx: -1, confirm: true }
};
let plotLive, plotAna, plotGrad, plotCal;

/* ---------- kleine Helfer ---------- */
let toastTimer;
function toast(msg, crit) { const e = $('#toast'); e.textContent = msg; e.className = 'show' + (crit ? ' crit' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => { e.className = ''; }, crit ? 7000 : 3500); }
function confirmDlg(text, yes, no, primary) {
  return new Promise(res => {
    const d = $('#dlg'); $('#dlgText').textContent = text; $('#dlgYes').textContent = yes || t('yes'); $('#dlgNo').textContent = no || t('no');
    $('#dlgYes').className = 'btn ' + (primary ? 'primary' : 'danger');
    const done = v => { d.close(); $('#dlgYes').onclick = $('#dlgNo').onclick = null; res(v); };
    $('#dlgYes').onclick = () => done(true); $('#dlgNo').onclick = () => done(false); d.oncancel = () => res(false);
    if (d.showModal) d.showModal(); else res(true);
  });
}
function log(line) { S.console.push(line); if (S.console.length > 80) S.console.splice(0, S.console.length - 80); }
async function logAudit(action, detail) { const e = { id: uid(), ts: new Date().toISOString(), action, detail: detail || '' }; S.auditLog.unshift(e); await Store.put('audit', e); if (S.tab === 'system') renderAudit(); }
const curMethod = () => S.methods.find(m => m.id === $('#selMethod').value) || S.methods[0];
const mmss = s => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const dateStr = iso => { try { return new Date(iso).toLocaleString(LANG === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return iso; } };
const fileSafe = s => String(s).replace(/[^\wäöüÄÖÜß.-]+/g, '_').slice(0, 60) || 'lauf';

/* ---------- Gerät ---------- */
function cmd(c) { if (!S.dev) return; S.dev.send(c); log('> ' + c); }
/* Methodenbefehl senden; hat der Aufbau Bauteile mit Rolle (Pumpe A/B, Injektionsventil), gehen die Befehle an diese */
function mcmd(name, value) {
  methodCommands(CTL.layouts.length ? ctlL().parts : [], S.mstate, name, value).forEach(o => { if (o.key) CTL.values[o.key] = o.value; cmd(o.cmd); });
}
async function connectDevice(kind) {
  if (S.phase !== 'idle') return;
  const native = isNativeApp();
  if (kind === 'usb' && !native && !('serial' in navigator)) { $('#connHint').textContent = t('usb_unsupported'); return; }
  if (kind === 'ble' && !native && !('bluetooth' in navigator)) { $('#connHint').textContent = t('ble_unsupported'); return; }
  await disconnectDevice();
  const dev = kind === 'usb' ? (native ? new AndroidSerialDevice(+$('#selBaud').value) : new SerialDevice(+$('#selBaud').value)) : kind === 'ble' ? (native ? new AndroidBleDevice() : new BleDevice()) : new SimDevice();
  dev.onLine = onLine;
  dev.onClose = () => { if (S.dev === dev) { S.dev = null; S.last = null; if (S.phase !== 'idle') finishRun(true); toast(t('conn_lost'), true); logAudit('disconnect', 'lost'); S.dirty = true; } };
  try { await dev.connect(); }
  catch (e) {
    if (e && e.name === 'NotFoundError') return;
    $('#connHint').textContent = (e && e.name === 'NoDeviceError') ? t('usb_nodevice') : (e && e.name === 'SecurityError') ? t(kind === 'ble' ? 'ble_blocked' : 'usb_blocked') : t('conn_failed') + ' ' + (e && e.message || '');
    return;
  }
  S.dev = dev; S.stage1 = false; S.last = null; CTL.fbDone = false; $('#connHint').textContent = '';
  CH.concat('t').forEach(k => { if (S.mon[k]) S.mon[k].length = 0; });
  if (kind === 'sim') dev.speed = +$('#selSpeed').value;
  cmd('RATE ' + curMethod().rate); ctlConfigure(true); if (kind !== 'sim') cmd('WATCHDOG 10');
  logAudit('connect', kind + (dev.name ? ' ' + dev.name : ''));
  S.dirty = true;
}
async function disconnectDevice() { if (S.dev) { const d = S.dev; S.dev = null; S.last = null; try { await d.close(); } catch (e) {} logAudit('disconnect', d.kind); S.dirty = true; } }

function onLine(line) {
  const s = parseLine(line);
  if (!s) { if (line.trim()) log(line); if (line.startsWith('READY')) { cmd('RATE ' + curMethod().rate); ctlConfigure(true); cmd('WATCHDOG 10'); } return; }   /* Arduino ist nach dem Neustart bereit */
  if (S.tab === 'system') log(line);
  if (S.dev && S.dev.kind !== 'sim' && performance.now() - S.lastPing > 2000) { S.lastPing = performance.now(); S.dev.send('PING'); }   /* Lebenszeichen für die Überwachung im Arduino */
  if (s.kind === 'event') { log(line); if (s.name === 'STOP') ctlStopAll(s.key || '?'); else { ctlLogLine(t('ctl_limit') + ' ' + s.key); toast(t('ctl_limit') + ' ' + s.key, true); } return; }
  if (s.kind === 'val') { ctlValue(s.key, s.value); S.dirty = true; return; }
  if (s.kind === 'stage1' && !S.stage1) { S.stage1 = true; toast(t('t_stage1')); }
  if (s.uv != null) s.uv *= 1000;                       /* intern in mAU */
  S.last = s;
  const m = S.mon; m.t.push(s.t); m.uv.push(s.uv); m.cond.push(s.cond); m.press.push(s.press); m.temp.push(s.temp); m.b.push(s.b);
  if (m.t.length > 9000) Object.keys(m).forEach(k => m[k].splice(0, 1500));
  if (S.phase === 'equil') {
    const r = S.run, me = r.method;
    if (r.tEq == null) r.tEq = s.t;
    if (s.press != null && s.press > me.pmax) {          /* Überdruck schon beim Equilibrieren */
      mcmd('STOP'); toast(t('t_overp'), true); logAudit('overpressure during equilibration', r.name); S.phase = 'idle'; S.run = null; if (S.seq.running) seqEnd(false); renderControls(); S.dirty = true; return;
    }
    const ready = s.b == null || (Math.abs(s.b - gradAt(me, 0)) < 0.6 && (s.flow == null || Math.abs(s.flow - me.flow) < 0.05));
    if ((ready && s.t - r.tEq >= 3) || s.t - r.tEq > 240) beginRun(s);
  } else if (S.phase === 'run') {
    const r = S.run, me = r.method, tm = (s.t - r.t0) / 60, d = r.data;
    d.t.push(+tm.toFixed(5)); CH.forEach(k => d[k].push(s[k] == null ? null : +s[k].toFixed(4)));
    const b = gradAt(me, tm);
    if (Math.abs(b - r.lastB) >= 0.1) { r.lastB = b; mcmd('PCTB', b.toFixed(1)); }
    (me.events || []).forEach((ev, i) => { if (!r.evDone[i] && tm >= ev.t) { r.evDone[i] = true; mcmd('VALVE', ev.pos); } });
    if (s.press != null && s.press > me.pmax) { mcmd('STOP'); toast(t('t_overp'), true); finishRun(true, 'overpressure'); }
    else if (tm >= me.runtime) finishRun(false);
  }
  S.dirty = true;
}

/* ---------- Lauf ---------- */
function startRun(opts) {
  if (!S.dev) { toast(t('t_noconn'), true); return; }
  if (S.phase !== 'idle') return;
  const o = opts || { name: $('#inName').value.trim() || 'Probe', type: $('#selType').value, conc: +$('#inConc').value, vol: +$('#inVol').value, site: $('#inSite').value.trim(), methodId: $('#selMethod').value };
  if (S.methods.some(q => q.id === o.methodId)) $('#selMethod').value = o.methodId;
  const m = clone(curMethod()), type = o.type;
  S.run = {
    id: uid(), name: o.name || 'Probe', type, conc: type === 'standard' ? +o.conc : null, vol: +o.vol || 0, site: o.site || '',
    methodId: m.id, method: m, device: S.dev.kind, simulated: S.dev.kind === 'sim', aborted: false, startedAt: null,
    data: { t: [], uv: [], cond: [], press: [], temp: [], flow: [], b: [] }, tEq: null, t0: 0, lastB: gradAt(m, 0), evDone: {}
  };
  if (S.dev.kind === 'sim') S.dev.sample = { type, conc: S.run.conc };
  cmd('LED 1'); S.led = true; cmd('RATE ' + m.rate); mcmd('FLOW', m.flow.toFixed(3)); mcmd('PCTB', S.run.lastB.toFixed(1)); mcmd('VALVE', 'LOAD');
  S.phase = 'equil'; S.view = { auto: true }; S.dirty = true; renderControls(); if (CTL.run) ctlProcEnd('stopped');
}
function beginRun(s) {
  const r = S.run;
  if (r.method.autozero) cmd(S.stage1 ? 'n' : 'ZERO');
  mcmd('VALVE', 'INJECT');
  r.t0 = s.t; r.startedAt = new Date().toISOString(); S.phase = 'run'; S.view = { auto: true }; renderControls();
}
async function finishRun(aborted, reason) {
  const r = S.run; if (!r) return;
  const wasRun = S.phase === 'run';
  S.phase = 'idle'; S.run = null; renderControls(); S.dirty = true;
  mcmd('VALVE', 'LOAD'); if (reason !== 'overpressure') mcmd('PCTB', gradAt(r.method, 0).toFixed(1));
  if (!wasRun || r.data.t.length < 5) { if (S.seq.running) seqEnd(false); return; }
  const rec = { id: r.id, name: r.name, type: r.type, conc: r.conc, vol: r.vol, site: r.site, methodId: r.methodId, method: r.method, device: r.device,
    simulated: r.simulated, aborted: !!aborted, reason: reason || '', startedAt: r.startedAt, data: r.data };
  await storeRun(rec, aborted ? 'run aborted' : 'run finished');
  toast(t('t_runsaved'));
  if (S.seq.running) {
    const row = S.seq.rows[S.seq.idx]; if (row) { row.status = aborted ? 'aborted' : 'done'; row.runId = rec.id; }
    seqSave(); renderSeq();
    if (aborted) seqEnd(false); else setTimeout(seqNext, 400);
    return;
  }
  $('#inName').value = $('#inName').value.replace(/(\d+)\s*$/, (m0, n) => String(+n + 1));
  openAnalysis(rec.id); location.hash = '#auswertung';
}
async function storeRun(rec, action) {
  rec.hash = await sha256(JSON.stringify(rec.data));
  const res = analyze(rec.data.t, rec.data.uv, ANALYSIS_DEFAULTS, rec.method.compounds);
  rec.analysis = { params: res.params, peaks: res.peaks, noise: res.noise, at: new Date().toISOString(), auto: true };
  S.runs.unshift(rec); await Store.put('runs', rec);
  await logAudit(action, rec.name + ' · ' + rec.method.name + (rec.hash ? ' · sha256 ' + rec.hash.slice(0, 12) : ''));
  renderRuns(); fillRunSelect();
}

/* Ansicht: x-Bereich und, nach einem Zoomfenster, der y-Bereich je Feld */
function newView(old, a, b, y) {
  if (a == null) return { auto: true };
  const ys = Object.assign({}, old.y || {}); if (y) ys[y.pane] = [y.lo, y.hi];
  return { auto: false, x0: a, x1: b, y: ys };
}
const yLim = (view, pane, base) => { const v = !view.auto && view.y && view.y[pane]; return v ? Object.assign({}, base, { min: v[0], max: v[1] }) : base; };

/* ---------- Messen: Anzeige ---------- */
function setPill(e, cls, text) { e.className = 'pill ' + cls; e.textContent = text; }
function renderStatus() {
  const k = S.dev ? S.dev.kind : null;
  setPill($('#pillConn'), k ? 'ok' : '', k === 'sim' ? t('conn_sim') : k === 'usb' ? t('conn_usb') : k === 'ble' ? t('conn_ble') : t('conn_none'));
  setPill($('#pillRun'), S.phase === 'run' ? 'run' : S.phase === 'equil' ? 'warn' : '', t(S.phase === 'run' ? 'ph_run' : S.phase === 'equil' ? 'ph_equil' : 'ph_idle'));
  const s = S.last || {}, m = S.run ? S.run.method : curMethod();
  const tile = (cls, key, val, unit, extra) => '<div class="tile ' + cls + '"><div class="k">' + t(key) + '</div><div class="v">' + val + (unit ? '<span class="u">' + unit + '</span>' : '') + '</div>' + (extra || '') + '</div>';
  const tRun = S.phase === 'run' ? mmss(s.t - S.run.t0) + '<span class="u">/ ' + mmss(m.runtime * 60) + '</span>' : '–';
  const pFrac = s.press != null && m ? s.press / m.pmax : 0;
  $('#tiles').innerHTML =
    tile('', 'tl_time', tRun) +
    tile('uv', 'tl_uv', fmt(s.uv, 2), 'mAU') +
    tile('press' + (pFrac > 1 ? ' crit' : pFrac > 0.85 ? ' warn' : ''), 'tl_press', fmt(s.press, 1), 'bar', '<div class="bar"><i style="width:' + Math.min(100, pFrac * 100).toFixed(0) + '%"></i></div>') +
    tile('', 'tl_flow', fmt(s.flow, 2), 'ml/min') +
    tile('grad', 'tl_b', fmt(s.b, 1), '%') +
    tile('', 'tl_valve', s.valve ? t(s.valve === 'INJECT' ? 'v_inject' : 'v_load') : '–') +
    tile('cond', 'tl_cond', fmt(s.cond, 1), 'µS/cm') +
    tile('temp', 'tl_temp', fmt(s.temp, 1), '°C');
}
function renderControls() {
  const idle = S.phase === 'idle';
  $('#btnStart').disabled = !idle || S.seq.running; $('#btnAbort').disabled = idle;
  ['#btnFlow', '#btnB', '#btnLoad', '#btnInject', '#btnZero', '#btnLed', '#btnPumpStop', '#selMethod'].forEach(q => { $(q).disabled = !idle; });
  $('#manLocked').hidden = idle;
  $('#btnLed').textContent = t(S.led ? 'led_off' : 'led_on');
  $('#inConc').disabled = $('#selType').value !== 'standard';
  if (CTL.layouts.length) ctlRenderNodes();          /* Sperre der Bauteile folgt dem Zustand des Laufs */
}
const PANE2 = { press: { label: 'ch_press', unit: 'bar', color: '--c-press', span: 1, dec: 2 }, cond: { label: 'ch_cond', unit: 'µS/cm', color: '--c-cond', span: 5, dec: 1 }, temp: { label: 'ch_temp', unit: '°C', color: '--c-temp', span: 1, dec: 2 } };
function drawLive() {
  const css = n => plotLive.css(n), p2 = PANE2[$('#pane2Sel').value], key = $('#pane2Sel').value, showB = $('#showGrad').checked;
  let x, d, x0, x1, m;
  if (S.phase === 'run') { m = S.run.method; d = S.run.data; x = d.t; x0 = 0; x1 = m.runtime; $('#liveTitle').textContent = S.run.name + ' · ' + m.name; }
  else { const mo = S.mon, tl = mo.t.length ? mo.t[mo.t.length - 1] : 0; x = mo.t.map(v => (v - tl) / 60); d = mo; x0 = -5; x1 = 0; $('#liveTitle').textContent = t('monitor'); }
  if (!S.view.auto) { x0 = S.view.x0; x1 = S.view.x1; }
  const top = [{ x, y: d.uv, color: css('--c-uv'), width: 1.6, label: 'UV', dec: 2, dot: true }];
  if (showB) {
    top.push({ x, y: d.b, color: css('--c-grad'), axis: 'R', width: 1, label: '%B', dec: 1 });
    if (m) top.push({ x: m.gradient.map(g => g.t), y: m.gradient.map(g => g.b), color: css('--c-grad'), axis: 'R', dash: [5, 4], width: 1 });
  }
  plotLive.set({ x0, x1, xLabel: t('min'), xUnit: t('min'), panes: [
    { h: 3, left: yLim(S.view, 0, { label: t('ch_uv') + ' [mAU]', minSpan: 5 }), right: showB ? { min: 0, max: 100, label: '%B', color: css('--c-grad') } : null, series: top },
    { h: 1, left: yLim(S.view, 1, { label: t(p2.label) + ' [' + p2.unit + ']', minSpan: p2.span }), series: [{ x, y: d[key], color: css(p2.color), width: 1.3, label: t(p2.label), dec: p2.dec }] }
  ] });
}

/* ---------- Methoden ---------- */
function fillMethodSelect() { const cur = $('#selMethod').value; $('#selMethod').innerHTML = S.methods.map(m => '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>').join(''); if (S.methods.some(m => m.id === cur)) $('#selMethod').value = cur;
  const c2 = $('#cSel').value; $('#cSel').innerHTML = $('#selMethod').innerHTML; $('#cSel').value = S.methods.some(m => m.id === c2) ? c2 : $('#selMethod').value; }
function renderMethodList() { $('#mList').innerHTML = S.methods.map(m => '<button type="button" data-id="' + esc(m.id) + '" class="' + (S.editM && S.editM.id === m.id ? 'sel' : '') + '">' + esc(m.name) + '</button>').join(''); }
function selectMethod(id) { const m = S.methods.find(q => q.id === id) || S.methods[0]; S.editM = m ? clone(m) : null; S.editDirty = false; renderMethodList(); renderEditor(); }
function renderEditor() {
  const m = S.editM, box = $('#mEditor'); if (!m) { box.innerHTML = ''; return; }
  const inp = (f, label, type, step) => '<label><span>' + t(label) + '</span><input data-f="' + f + '" type="' + type + '"' + (step ? ' step="' + step + '" min="0"' : '') + ' value="' + esc(m[f]) + '"></label>';
  const rows = (arr, list, cols) => arr.map((r, i) => '<tr>' + cols.map(c => '<td>' + (c.sel
    ? '<select data-l="' + list + '" data-i="' + i + '" data-k="' + c.k + '">' + c.sel.map(o => '<option value="' + o + '"' + (r[c.k] === o ? ' selected' : '') + '>' + t(o === 'LOAD' ? 'v_load' : 'v_inject') + '</option>').join('') + '</select>'
    : '<input data-l="' + list + '" data-i="' + i + '" data-k="' + c.k + '" type="' + (c.text ? 'text' : 'number') + '" step="any" value="' + esc(r[c.k]) + '">') + '</td>').join('') +
    '<td><button type="button" class="btn small" data-rm="' + list + '" data-i="' + i + '" aria-label="entfernen">✕</button></td></tr>').join('');
  const table = (list, cols) => '<div class="tablewrap"><table class="edit"><tr>' + cols.map(c => '<th>' + t(c.h) + '</th>').join('') + '<th></th></tr>' + rows(m[list], list, cols) + '</table></div><button type="button" class="btn small" data-add="' + list + '">+ ' + t('add_row') + '</button>';
  box.innerHTML =
    '<div class="toolbar"><h2>' + t('method') + '</h2><span class="dirty" id="mDirty"></span><span class="grow"></span><button type="button" class="btn primary" id="mSave">' + t('m_save') + '</button></div>' +
    '<div class="form three"><label class="wide"><span>' + t('m_name') + '</span><input data-f="name" type="text" value="' + esc(m.name) + '"></label>' +
    inp('column', 'm_column', 'text') + inp('solventA', 'm_a', 'text') + inp('solventB', 'm_b', 'text') +
    inp('flow', 'flow', 'number', '0.05') + inp('runtime', 'm_runtime', 'number', '0.5') + inp('rate', 'm_rate', 'number', '1') + inp('pmax', 'm_pmax', 'number', '0.5') +
    '<label class="chk"><input data-f="autozero" type="checkbox"' + (m.autozero ? ' checked' : '') + '> <span>' + t('m_autozero') + '</span></label></div>' +
    '<h3>' + t('m_grad') + '</h3><div class="chartwrap small"><canvas id="cvGrad"></canvas></div>' + table('gradient', [{ k: 't', h: 'm_time' }, { k: 'b', h: 'pctb' }]) +
    '<h3>' + t('m_events') + '</h3>' + table('events', [{ k: 't', h: 'm_time' }, { k: 'pos', h: 'm_pos', sel: ['LOAD', 'INJECT'] }]) +
    '<h3>' + t('m_comp') + '</h3>' + table('compounds', [{ k: 'name', h: 'm_cname', text: true }, { k: 'rt', h: 'm_rt' }, { k: 'tol', h: 'm_tol' }]);
  plotGrad = new Plot($('#cvGrad'));
  drawGrad(); markDirty(S.editDirty);
}
function markDirty(v) { S.editDirty = v; const e = $('#mDirty'); if (e) e.textContent = v ? t('m_unsaved') : ''; }
function drawGrad() {
  const m = S.editM; if (!m || !plotGrad) return;
  const g = m.gradient.slice().sort((a, b) => a.t - b.t);
  plotGrad.set({ x0: 0, x1: Math.max(0.5, +m.runtime || 1), xLabel: t('min'), xUnit: t('min'), panes: [{ h: 1, left: { label: t('pctb'), min: 0, max: 100 },
    series: [{ x: g.map(q => q.t), y: g.map(q => q.b), color: plotGrad.css('--c-grad'), width: 2, label: '%B', dec: 1 }] }] });
}
function editorEvent(e) {
  const el = e.target, m = S.editM; if (!m) return;
  if (el.dataset.f) { const f = el.dataset.f; m[f] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value; markDirty(true); drawGrad(); }
  else if (el.dataset.l) { const r = m[el.dataset.l][+el.dataset.i]; r[el.dataset.k] = el.type === 'number' ? +el.value : el.value; markDirty(true); drawGrad(); }
}
function editorClick(e) {
  const el = e.target.closest('button'), m = S.editM; if (!el || !m) return;
  if (el.dataset.add) { const l = el.dataset.add, last = m[l][m[l].length - 1]; m[l].push(l === 'gradient' ? { t: last ? last.t + 1 : 0, b: last ? last.b : 5 } : l === 'events' ? { t: 0, pos: 'LOAD' } : { name: '', rt: 1, tol: 0.25 }); markDirty(true); renderEditor(); }
  else if (el.dataset.rm) { m[el.dataset.rm].splice(+el.dataset.i, 1); markDirty(true); renderEditor(); }
  else if (el.id === 'mSave') saveMethod();
}
async function saveMethod() {
  const m = S.editM; m.gradient.sort((a, b) => a.t - b.t); m.events.sort((a, b) => a.t - b.t);
  if (!m.gradient.length) m.gradient.push({ t: 0, b: 5 });
  m.rate = Math.max(1, Math.min(50, +m.rate || 10)); m.runtime = Math.max(0.5, +m.runtime || 1); m.name = m.name || 'Methode';
  m.changedAt = new Date().toISOString();
  const i = S.methods.findIndex(q => q.id === m.id);
  const sig = q => JSON.stringify([q.flow, q.gradient, q.compounds, q.column, q.solventA, q.solventB]);
  if (i >= 0 && m.calibration && sig(S.methods[i]) !== sig(m)) { delete m.calibration; toast(t('c_reset'), true); }
  const copy = clone(m);
  if (i >= 0) S.methods[i] = copy; else S.methods.push(copy);
  await Store.put('methods', copy); await logAudit('method saved', m.name);
  const hadToast = $('#toast').classList.contains('crit');
  fillMethodSelect(); renderMethodList(); renderEditor(); markDirty(false); if (!hadToast) toast(t('saved'));
}

/* ---------- Läufe ---------- */
function renderRuns() {
  if (!S.runs.length) { $('#runTable').innerHTML = '<p class="hint">' + t('r_none') + '</p>'; return; }
  $('#runTable').innerHTML = '<table><tr><th>' + t('r_name') + '</th><th>' + t('type') + '</th><th>' + t('r_date') + '</th><th>' + t('method') + '</th><th class="n">' + t('r_dur') + '</th><th class="n">' + t('r_peaks') + '</th><th></th></tr>' +
    S.runs.map(r => '<tr><td>' + esc(r.name) + (r.example ? '<span class="badge">' + t('r_example') + '</span>' : r.simulated ? '<span class="badge">' + t('r_sim') + '</span>' : '') + (r.aborted ? '<span class="badge crit">' + t('r_aborted') + '</span>' : '') + (r.hashMismatch ? '<span class="badge crit">' + t('hash_badge') + '</span>' : '') + '</td>' +
      '<td>' + t('ty_' + r.type) + (r.conc != null ? ' ' + fmt(r.conc, 1) + ' mg/l' : '') + '</td><td>' + esc(dateStr(r.startedAt)) + '</td><td>' + esc(r.method.name) + '</td>' +
      '<td class="n">' + fmt(r.data.t[r.data.t.length - 1], 1) + ' min</td><td class="n">' + (r.analysis ? r.analysis.peaks.length : '–') + '</td>' +
      '<td><button type="button" class="btn small primary" data-open="' + r.id + '">' + t('r_open') + '</button> <button type="button" class="btn small" data-csv="' + r.id + '">' + t('csv') + '</button> ' +
      '<button type="button" class="btn small" data-json="' + r.id + '">' + t('json') + '</button> <button type="button" class="btn small danger" data-del="' + r.id + '">' + t('yes') + '</button></td></tr>').join('') + '</table>';
}
function runCsv(r) {
  const d = r.data, head = ['# ChromaLog', '# sample: ' + r.name, '# type: ' + r.type + (r.conc != null ? ' ' + r.conc + ' mg/l' : ''), '# method: ' + r.method.name, '# start: ' + r.startedAt, '# device: ' + r.device, '# sha256: ' + (r.hash || ''),
    't_min,uv_mAU,cond_uS_cm,press_bar,temp_C,flow_ml_min,pctB'];
  const v = x => x == null ? '' : x;
  return head.concat(d.t.map((tt, i) => [tt, v(d.uv[i]), v(d.cond[i]), v(d.press[i]), v(d.temp[i]), v(d.flow[i]), v(d.b[i])].join(','))).join('\n') + '\n';
}
async function exportRun(r, kind) {
  const ok = await saveFile(fileSafe(r.name) + '_' + (r.startedAt || '').slice(0, 10) + '.' + kind, kind === 'csv' ? runCsv(r) : JSON.stringify(r));
  if (!ok) toast(t('t_declined')); else logAudit('export ' + kind, r.name);
}
async function runsClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  const id = b.dataset.open || b.dataset.csv || b.dataset.json || b.dataset.del, r = S.runs.find(q => q.id === id); if (!r) return;
  if (b.dataset.open) { openAnalysis(id); location.hash = '#auswertung'; }
  else if (b.dataset.csv) exportRun(r, 'csv');
  else if (b.dataset.json) exportRun(r, 'json');
  else if (await confirmDlg(t('del_run'))) {
    S.runs = S.runs.filter(q => q.id !== id); await Store.del('runs', id); await logAudit('run deleted', r.name);
    if (S.aRun && S.aRun.id === id) { S.aRun = null; S.aRes = null; }
    renderRuns(); fillRunSelect(); renderAnalysis();
  }
}
async function importRun(file) {
  try {
    const r = JSON.parse(await file.text());
    if (!r || !r.data || !Array.isArray(r.data.t) || !Array.isArray(r.data.uv) || !r.method) throw new Error('format');
    r.id = uid(); CH.forEach(k => { if (!Array.isArray(r.data[k])) r.data[k] = r.data.t.map(() => null); });
    r.name = r.name || file.name; r.type = r.type || 'sample'; r.startedAt = r.startedAt || new Date().toISOString();
    const claimed = r.hash || null; delete r.hashMismatch;
    await storeRun(r, 'run imported');
    if (claimed && r.hash && claimed !== r.hash) { r.hashMismatch = true; r.hashClaimed = claimed; await Store.put('runs', r); await logAudit('checksum mismatch on import', r.name); renderRuns(); toast(t('t_hashbad'), true); }
    else toast(t('t_imported'));
  } catch (e) { toast(t('t_badfile'), true); }
}

/* ---------- Auswertung ---------- */
function fillRunSelect() { $('#aSel').innerHTML = S.runs.map(r => '<option value="' + r.id + '">' + esc(r.name + ' · ' + dateStr(r.startedAt)) + '</option>').join(''); if (S.aRun) $('#aSel').value = S.aRun.id; }
function openAnalysis(id) {
  const r = S.runs.find(q => q.id === id); if (!r) return;
  S.aRun = r; S.aView = { auto: true }; S.aOverlay = S.aOverlay.filter(q => q !== id);
  S.aEdits = r.analysis && r.analysis.edits ? clone(r.analysis.edits) : { manual: [], removed: [] };
  const p = (r.analysis && r.analysis.params) || ANALYSIS_DEFAULTS;
  $('#aSn').value = p.sn; $('#aMinW').value = p.minWidth; $('#aBase').value = p.baseWin; $('#aSmooth').value = p.smooth;
  integrate(); fillRunSelect();
  S.aHash = 'unknown';
  sha256(JSON.stringify(r.data)).then(h => {
    if (S.aRun !== r) return;
    S.aHash = (!h || !r.hash) ? 'unknown' : (h === r.hash && !r.hashMismatch) ? 'ok' : 'bad';
    if (S.aHash === 'bad') { toast(t('t_hashbad'), true); logAudit('checksum mismatch', r.name); }
    renderAnalysis();
  });
}
function integrate() {
  const r = S.aRun; if (!r) return;
  const p = { sn: +$('#aSn').value || 5, minWidth: +$('#aMinW').value || 3, baseWin: +$('#aBase').value || 1.5, smooth: +$('#aSmooth').value || 0 };
  S.aRes = analyze(r.data.t, r.data.uv, p, r.method.compounds, S.aEdits); renderAnalysis();
}
function renderAnalysis() {
  const r = S.aRun, res = S.aRes;
  if (!r || !res) { $('#peakTable').innerHTML = '<p class="hint">' + t('a_none') + '</p>'; $('#aMeta').innerHTML = ''; if (plotAna) { plotAna.spec = null; const c = $('#cvAna'); c.getContext('2d').clearRect(0, 0, c.width, c.height); } return; }
  const n = v => '<td class="n">' + v + '</td>';
  $('#peakTable').innerHTML = !res.peaks.length ? '<p class="hint">' + t('a_nopeaks') + '</p>' :
    '<table><tr><th class="n">#</th><th>' + t('p_name') + '</th><th class="n">' + t('p_conc') + '</th>' + ['p_rt', 'p_area', 'p_areap', 'p_height', 'p_w', 'p_n', 'p_tail', 'p_rs', 'p_sn'].map(k => '<th class="n">' + t(k) + '</th>').join('') + '<th></th></tr>' +
    res.peaks.map((p, i) => '<tr>' + n(i + 1) + '<td>' + (p.name ? esc(p.name) : '<span class="hint">' + t('unknown') + '</span>') + (p.manual ? '<span class="badge">' + t('a_man') + '</span>' : '') + '</td>' + n(concCell(r, p)) + n(fmt(p.rt, 3)) + n(fmt(p.area, 1)) + n(fmt(p.areaPct, 1)) + n(fmt(p.height, 2)) +
      n(fmt(p.w50, 1)) + n(fmt(p.plates, 0)) + n(fmt(p.tailing, 2)) + n(fmt(p.rs, 1)) + n(fmt(p.sn, 0)) + '<td><button type="button" class="btn small" data-rmpk="' + i + '" title="' + t('a_remove') + '" aria-label="' + t('a_remove') + '">✕</button></td></tr>').join('') + '</table>' +
    (res.peaks.some(p => { const c = concOf(r, p); return c && c.out; }) ? '<p class="hint">' + t('c_outside') + '</p>' : '');
  const row = (k, v, mono) => '<dt>' + t(k) + '</dt><dd' + (mono ? ' class="mono"' : '') + '>' + v + '</dd>';
  $('#aMeta').innerHTML = row('sample', esc(r.name) + ' (' + t('ty_' + r.type) + (r.conc != null ? ', ' + fmt(r.conc, 1) + ' mg/l' : '') + ')') + row('method', esc(r.method.name)) + row('a_started', esc(dateStr(r.startedAt))) +
    (r.site ? row('site', esc(r.site)) : '') + row('vol', fmt(r.vol, 0) + ' µl') + row('a_points', fmt(r.data.t.length, 0)) + row('a_noise', fmt(res.noise, 3) + ' mAU') + row('a_hash', (r.hash ? r.hash.slice(0, 16) + '… ' : '') + '<span style="font-family:var(--f-body);color:var(--' + (S.aHash === 'bad' ? 'crit' : S.aHash === 'ok' ? 'ok' : 'muted') + ')">' + t('hash_' + S.aHash) + '</span>', true);
  $('#aManual').classList.toggle('on', S.aManualMode); $('#aHint').textContent = t(S.aManualMode ? 'a_manual_hint' : 'hint_zoom');
  $('#aClear').disabled = !(S.aEdits.manual.length || S.aEdits.removed.length);
  $('#aCompare').innerHTML = S.runs.filter(q => q.id !== r.id).slice(0, 30).map(q => { const k = S.aOverlay.indexOf(q.id);
    return '<label><input type="checkbox" data-cmp="' + q.id + '"' + (k >= 0 ? ' checked' : '') + '><i style="background:' + (k >= 0 ? plotAna.css(CMP_COLORS[k % CMP_COLORS.length]) : 'transparent') + '"></i><span>' + esc(q.name) + ' · ' + esc(dateStr(q.startedAt)) + '</span></label>'; }).join('');
  drawAna();
}
const CMP_COLORS = ['--c-grad', '--c-press', '--c-temp', '--c-cond', '--muted'];
function anaSpec(r, res, view, overlay, plot) {
  const css = n => plot.css(n), d = r.data;
  let x0 = 0, x1 = Math.max(d.t[d.t.length - 1] || 1, 0.1); if (!view.auto) { x0 = view.x0; x1 = view.x1; }
  const peaks = res.peaks.map(p => ({ start: p.start, end: p.end, yStart: p.yStart, yEnd: p.yEnd, rt: p.rt, name: p.name, yApex: d.uv[Math.min(d.uv.length - 1, lowerBound(d.t, p.rt))] }));
  return { x0, x1, xLabel: t('min'), xUnit: t('min'), panes: [
    { h: 3, left: yLim(view, 0, { label: t('ch_uv') + ' [mAU]', minSpan: 5 }), series: [{ x: d.t, y: d.uv, color: css('--c-uv'), width: 1.5, label: 'UV', dec: 2 }].concat(
      overlay.map((id, k) => { const q = S.runs.find(z => z.id === id); return q ? { x: q.data.t, y: q.data.uv, color: css(CMP_COLORS[k % CMP_COLORS.length]), width: 1.1, label: q.name.slice(0, 14), dec: 2 } : null; }).filter(Boolean)), peaks },
    { h: 1, left: yLim(view, 1, { label: t('ch_press') + ' [bar]', minSpan: 1 }), right: { min: 0, max: 100, label: '%B', color: css('--c-grad') },
      series: [{ x: d.t, y: d.press, color: css('--c-press'), width: 1.3, label: t('ch_press'), dec: 2 }, { x: d.t, y: d.b, color: css('--c-grad'), axis: 'R', width: 1.2, label: '%B', dec: 1 }] }
  ] };
}
function drawAna() {
  const r = S.aRun, res = S.aRes; if (!r || !res || S.tab !== 'auswertung') return;
  plotAna.rangeMode = S.aManualMode; plotAna.set(anaSpec(r, res, S.aView, S.aOverlay, plotAna));
}
async function saveAnalysis() {
  const r = S.aRun, res = S.aRes; if (!r || !res) return;
  res.peaks.forEach(p => { const c = concOf(r, p); p.conc = c ? c.v : null; });
  r.analysis = { params: res.params, peaks: res.peaks, noise: res.noise, at: new Date().toISOString(), auto: false, edits: clone(S.aEdits) };
  await Store.put('runs', r); await logAudit('analysis saved', r.name + ' · ' + res.peaks.length + ' peaks · S/N ' + res.params.sn + ' · manual ' + S.aEdits.manual.length + ' · removed ' + S.aEdits.removed.length);
  renderRuns(); toast(t('saved'));
}

/* ---------- Messbericht ---------- */
const REPORT_CSS = '.paper{background:#fff;color:#111;font:12px/1.45 "IBM Plex Sans",Arial,Helvetica,sans-serif;padding:28px 32px;max-width:900px;margin:0 auto;border:1px solid #c8c8c8}' +
  '.paper h1{font-size:20px;margin:0 0 2px;font-weight:600}.paper h2{font:600 11px/1.2 "IBM Plex Sans",Arial,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#333;margin:18px 0 6px;border-bottom:1px solid #888;padding-bottom:3px}' +
  '.paper .head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;border-bottom:2px solid #111;padding-bottom:8px}.paper .ver{font-size:11px;color:#555;white-space:nowrap}' +
  '.paper table{border-collapse:collapse;width:100%;font-size:11px}.paper th,.paper td{padding:3px 6px;border-bottom:1px solid #ccc;text-align:left;white-space:nowrap;color:#111;font-weight:400}.paper th{color:#555;font-size:10px}' +
  '.paper td.n,.paper th.n{text-align:right;font-family:"IBM Plex Mono",Consolas,monospace}.paper .scroll{overflow-x:auto}' +
  '.paper .kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 28px}.paper .kv div{display:flex;gap:8px}.paper .kv b{font-weight:400;color:#555;flex:0 0 150px}.paper .kv span{overflow-wrap:anywhere}' +
  '.paper p{margin:6px 0 0}.paper p b{font-weight:400;color:#555}.paper .mono{font-family:"IBM Plex Mono",Consolas,monospace;font-size:10px;overflow-wrap:anywhere}' +
  '.paper img{display:block;width:100%;height:auto}.paper .warn{border:1px solid #b42318;color:#b42318;padding:4px 8px;margin-top:10px}' +
  '.paper .sign{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:46px}.paper .sign div{border-top:1px solid #111;padding-top:3px;font-size:10px;color:#555}.paper .foot{margin-top:14px;font-size:10px;color:#666}' +
  '@media (max-width:560px){.paper{padding:16px}.paper .kv{grid-template-columns:minmax(0,1fr)}}';
const LIGHT = { '--ink': '#17202b', '--muted': '#5b6878', '--line': '#d3d9e1', '--panel': '#ffffff', '--accent': '#5a3fd0', '--c-uv': '#5a3fd0', '--c-grad': '#c2500e', '--c-press': '#0d7a70', '--c-cond': '#a16207', '--c-temp': '#b81f62' };
function reportImage(r, res) {
  const host = document.createElement('div'), cv = document.createElement('canvas');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;width:1000px;height:470px'; host.appendChild(cv); document.body.appendChild(host);
  const pl = new Plot(cv); pl.theme = LIGHT; pl.set(anaSpec(r, res, { auto: true }, [], pl));
  const url = cv.toDataURL('image/png'); host.remove(); return url;
}
function reportBody(r, res) {
  const m = r.method, mc = S.methods.find(q => q.id === r.methodId), cal = mc && mc.calibration, p = res.params;
  const kv = (k, v) => '<div><b>' + esc(k) + '</b><span>' + v + '</span></div>', n = v => '<td class="n">' + v + '</td>';
  let h = '<div class="head"><div><h1>' + t('rep_title') + '</h1><div>' + esc(r.name) + '</div></div><div class="ver">ChromaLog ' + APP_VERSION + '</div></div>';
  if (r.simulated) h += '<div class="warn">' + t('rep_sim') + '</div>';
  if (r.aborted) h += '<div class="warn">' + t('rep_abort') + '</div>';
  h += '<h2>' + t('rep_sample') + '</h2><div class="kv">' + kv(t('sample'), esc(r.name)) + kv(t('type'), t('ty_' + r.type) + (r.conc != null ? ', ' + fmt(r.conc, 2) + ' mg/l' : '')) + kv(t('a_started'), esc(dateStr(r.startedAt))) +
    kv(t('vol'), fmt(r.vol, 0)) + kv(t('site'), esc(r.site || '–')) + kv(t('rep_device'), esc(r.device || '–')) + '</div>';
  h += '<h2>' + t('rep_method') + '</h2><div class="kv">' + kv(t('m_name'), esc(m.name)) + kv(t('m_column'), esc(m.column || '–')) + kv(t('m_a'), esc(m.solventA || '–')) + kv(t('m_b'), esc(m.solventB || '–')) +
    kv(t('flow'), fmt(m.flow, 2)) + kv(t('m_runtime'), fmt(m.runtime, 1)) + kv(t('m_rate'), fmt(m.rate, 0)) + kv(t('m_pmax'), fmt(m.pmax, 1)) + '</div>' +
    '<p><b>' + t('m_grad') + ':</b> ' + m.gradient.map(g => fmt(g.t, 1) + ' min ' + fmt(g.b, 0) + ' %').join(' → ') + '</p>';
  h += '<h2>' + t('rep_chrom') + '</h2><img alt="' + t('rep_chrom') + '" src="' + reportImage(r, res) + '">';
  h += '<h2>' + t('rep_result') + '</h2>' + (!res.peaks.length ? '<p>' + t('a_nopeaks') + '</p>' :
    '<div class="scroll"><table><tr><th class="n">#</th><th>' + t('p_name') + '</th>' + ['p_conc', 'p_rt', 'p_area', 'p_areap', 'p_height', 'p_w', 'p_n', 'p_tail', 'p_rs', 'p_sn'].map(k => '<th class="n">' + t(k) + '</th>').join('') + '</tr>' +
    res.peaks.map((q, i) => '<tr>' + n(i + 1) + '<td>' + esc(q.name || t('unknown')) + (q.manual ? ' (' + t('a_man') + ')' : '') + '</td>' + n(concCell(r, q)) + n(fmt(q.rt, 3)) + n(fmt(q.area, 1)) + n(fmt(q.areaPct, 1)) + n(fmt(q.height, 2)) +
      n(fmt(q.w50, 1)) + n(fmt(q.plates, 0)) + n(fmt(q.tailing, 2)) + n(fmt(q.rs, 1)) + n(fmt(q.sn, 0)) + '</tr>').join('') + '</table></div>' +
    (res.peaks.some(q => { const c = concOf(r, q); return c && c.out; }) ? '<p>' + t('c_outside') + '</p>' : ''));
  h += '<h2>' + t('rep_cal') + '</h2>' + (!cal ? '<p>' + t('rep_nocal') + '</p>' :
    '<div class="scroll"><table><tr><th>' + t('p_name') + '</th>' + ['c_n', 'c_slope', 'c_icpt', 'c_r2', 'c_range'].map(k => '<th class="n">' + t(k) + '</th>').join('') + '</tr>' +
    Object.keys(cal.compounds).map(k => { const c = cal.compounds[k]; return '<tr><td>' + esc(k) + '</td>' + n(c.n) + n(fmt(c.slope, 2)) + n(fmt(c.intercept, 1)) + n(fmt(c.r2, 4)) + n(c.min == null ? '–' : fmt(c.min, 1) + ' – ' + fmt(c.max, 1)) + '</tr>'; }).join('') +
    '</table></div><p><b>' + t('c_savedat') + ':</b> ' + esc(dateStr(cal.at)) + (cal.zero ? ' · ' + t('c_zero') : '') + '</p>');
  h += '<h2>' + t('rep_integ') + '</h2><div class="kv">' + kv(t('a_sn'), fmt(p.sn, 1)) + kv(t('a_minw'), fmt(p.minWidth, 1)) + kv(t('a_base'), fmt(p.baseWin, 1)) + kv(t('a_smooth'), fmt(p.smooth, 1)) +
    kv(t('a_noise'), fmt(res.noise, 3) + ' mAU') + kv(t('a_points'), fmt(r.data.t.length, 0)) + kv(t('rep_manual'), S.aEdits.manual.length) + kv(t('rep_removed'), S.aEdits.removed.length) +
    kv(t('rep_saved'), esc(dateStr(r.analysis && r.analysis.at))) + kv(t('rep_version'), 'ChromaLog ' + APP_VERSION) + '</div>' +
    '<p><b>' + t('a_hash') + ' (SHA-256):</b> <span class="mono">' + esc(r.hash || '–') + '</span> – ' + t('hash_' + S.aHash) + '</p>' + (S.aHash === 'bad' ? '<div class="warn">' + t('t_hashbad') + '</div>' : '');
  h += '<div class="sign"><div>' + t('rep_by') + '</div><div>' + t('rep_date') + '</div><div>' + t('rep_sig') + '</div></div>' +
    '<div class="foot">' + t('rep_made') + ' ' + APP_VERSION + ' · ' + esc(dateStr(new Date().toISOString())) + '</div>';
  return h;
}
async function openReport() { if (!S.aRun || !S.aRes) return; await saveAnalysis(); location.hash = '#bericht'; }
function renderReport() { if (!S.aRun || !S.aRes) { location.hash = '#auswertung'; return; } $('#report').innerHTML = reportBody(S.aRun, S.aRes); }
async function exportReport() {
  const r = S.aRun; if (!r) return;
  const doc = '<!DOCTYPE html><html lang="' + LANG + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(t('rep_title') + ' ' + r.name) +
    '</title><style>body{margin:0;background:#fff}' + REPORT_CSS + '@media print{.paper{border:0;padding:0;max-width:none}}</style></head><body><div class="paper">' + $('#report').innerHTML + '</div></body></html>';
  const ok = await saveFile(fileSafe(r.name) + '_' + (r.startedAt || '').slice(0, 10) + '_Bericht.html', doc);
  if (!ok) toast(t('t_declined')); else logAudit('report exported', r.name);
}

/* ---------- Sequenz ---------- */
function seqSave() { Store.put('kv', { id: 'sequence', rows: S.seq.rows, confirm: S.seq.confirm }); }
function renderSeq() {
  const q = S.seq, lock = q.running, dis = lock ? ' disabled' : '';
  $('#qConfirm').checked = q.confirm; $('#qStart').disabled = lock || !q.rows.length; $('#qStop').disabled = !lock;
  ['#qAdd', '#qTemplate', '#qClear', '#qConfirm'].forEach(k => { $(k).disabled = lock; });
  const mopts = id => S.methods.map(m => '<option value="' + esc(m.id) + '"' + (m.id === id ? ' selected' : '') + '>' + esc(m.name) + '</option>').join('');
  const topts = ty => ['blank', 'standard', 'sample'].map(k => '<option value="' + k + '"' + (k === ty ? ' selected' : '') + '>' + t('ty_' + k) + '</option>').join('');
  const st = r => { const k = r.status || 'wait'; return '<span class="badge ' + (k === 'done' ? 'ok' : k === 'running' ? 'run' : k === 'aborted' ? 'crit' : '') + '">' + t('q_' + k) + '</span>'; };
  $('#qTable').innerHTML = !q.rows.length ? '<p class="hint">' + t('q_empty') + '</p>' :
    '<table class="edit seq"><tr><th>#</th><th>' + t('sample') + '</th><th>' + t('type') + '</th><th>' + t('conc') + '</th><th>' + t('vol') + '</th><th>' + t('method') + '</th><th>' + t('q_status') + '</th><th></th></tr>' +
    q.rows.map((r, i) => '<tr><td class="n">' + (i + 1) + '</td><td><input type="text" data-q="' + i + '" data-k="name" value="' + esc(r.name) + '"' + dis + '></td>' +
      '<td><select data-q="' + i + '" data-k="type"' + dis + '>' + topts(r.type) + '</select></td>' +
      '<td><input type="number" step="any" min="0" data-q="' + i + '" data-k="conc" value="' + (r.conc == null ? '' : r.conc) + '"' + (lock || r.type !== 'standard' ? ' disabled' : '') + '></td>' +
      '<td><input type="number" step="1" min="0" data-q="' + i + '" data-k="vol" value="' + r.vol + '"' + dis + '></td>' +
      '<td><select data-q="' + i + '" data-k="methodId"' + dis + '>' + mopts(r.methodId) + '</select></td>' +
      '<td>' + st(r) + (r.runId && S.runs.some(z => z.id === r.runId) ? ' <button type="button" class="btn small" data-qopen="' + r.runId + '">' + t('r_open') + '</button>' : '') + '</td>' +
      '<td><button type="button" class="btn small" data-qrm="' + i + '" aria-label="entfernen"' + dis + '>✕</button></td></tr>').join('') + '</table>';
}
function seqStart() {
  const q = S.seq; if (q.running || S.phase !== 'idle' || !q.rows.length) return;
  if (!S.dev) { toast(t('t_noconn'), true); return; }
  if (q.rows.every(r => r.status === 'done')) q.rows.forEach(r => { r.status = ''; r.runId = null; });
  q.running = true; logAudit('sequence started', q.rows.length + ' rows'); renderSeq(); renderControls(); seqNext();
}
async function seqNext() {
  const q = S.seq; if (!q.running) return;
  const i = q.rows.findIndex(r => r.status !== 'done');
  if (i < 0) { seqEnd(true); return; }
  const row = q.rows[i];
  if (q.confirm && !(await confirmDlg(t('q_next') + ' ' + row.name + ' (' + t('ty_' + row.type) + '). ' + t('q_next2'), t('q_go'), t('q_stop'), true))) { seqEnd(false); return; }
  if (!S.dev || !q.running) { seqEnd(false); return; }
  q.idx = i; row.status = 'running'; row.runId = null; renderSeq();
  if (S.tab !== 'messen') location.hash = '#messen';
  startRun({ name: row.name, type: row.type, conc: row.conc, vol: row.vol, site: '', methodId: row.methodId });
}
function seqEnd(ok) {
  const q = S.seq; if (!q.running) return;
  q.running = false; q.idx = -1; q.rows.forEach(r => { if (r.status === 'running') r.status = 'aborted'; });
  seqSave(); renderSeq(); renderControls();
  logAudit(ok ? 'sequence finished' : 'sequence stopped', q.rows.filter(r => r.status === 'done').length + ' / ' + q.rows.length);
  if (ok) { toast(t('q_finished')); location.hash = '#sequenz'; }
}

/* ---------- Kalibrierung und Quantifizierung ---------- */
function concOf(run, pk) {
  const m = S.methods.find(q => q.id === run.methodId), c = m && m.calibration && pk.name && m.calibration.compounds[pk.name];
  return quantify(pk.area, c);
}
function concCell(run, pk) { const c = concOf(run, pk); return c ? fmt(c.v, 2) + (c.out ? ' *' : '') : '–'; }
const calMethod = () => S.methods.find(m => m.id === $('#cSel').value) || S.methods[0];
const calRuns = m => S.runs.filter(r => r.type === 'standard' && r.methodId === m.id && r.conc > 0 && !r.aborted && r.analysis).sort((a, b) => a.conc - b.conc);
function computeCal(m) {
  const runs = calRuns(m).filter(r => !S.cal.excluded[r.id]), zero = $('#cZero').checked, compounds = {};
  (m.compounds || []).forEach(c => {
    const pts = [];
    runs.forEach(r => { const pk = r.analysis.peaks.filter(p => p.name === c.name).sort((a, b) => b.area - a.area)[0]; if (pk) pts.push({ conc: r.conc, area: pk.area, sn: pk.sn }); });
    compounds[c.name] = Object.assign({ points: pts }, linFit(pts, zero));
  });
  return { zero, runs: runs.map(r => r.id), compounds };
}
function renderCal() {
  const m = calMethod(); if (!m) return;
  const all = calRuns(m), res = S.cal.res = computeCal(m), names = Object.keys(res.compounds);
  if (!names.includes(S.cal.sel)) S.cal.sel = names[0] || null;
  $('#cSaved').textContent = m.calibration ? t('c_savedat') + ' ' + dateStr(m.calibration.at) : t('c_notsaved');
  $('#cSave').disabled = !names.some(k => res.compounds[k].slope > 0);
  $('#cRuns').innerHTML = !all.length
    ? '<p class="hint">' + t('c_none') + '</p><div class="row"><button type="button" class="btn" id="cExample">' + t('c_example') + '</button></div>'
    : '<table><tr><th>' + t('c_use') + '</th><th>' + t('r_name') + '</th><th class="n">' + t('conc') + '</th><th>' + t('r_date') + '</th><th class="n">' + t('r_peaks') + '</th></tr>' +
      all.map(r => '<tr><td><input type="checkbox" data-run="' + r.id + '"' + (S.cal.excluded[r.id] ? '' : ' checked') + ' aria-label="' + esc(r.name) + '"></td><td>' + esc(r.name) + (r.simulated ? '<span class="badge">' + t('r_sim') + '</span>' : '') + '</td><td class="n">' + fmt(r.conc, 2) +
        '</td><td>' + esc(dateStr(r.startedAt)) + '</td><td class="n">' + r.analysis.peaks.filter(p => p.name).length + '</td></tr>').join('') + '</table>';
  const n = v => '<td class="n">' + v + '</td>';
  $('#cTable').innerHTML = !names.length ? '<p class="hint">' + t('m_comp') + ': –</p>' :
    '<table><tr><th>' + t('p_name') + '</th>' + ['c_n', 'c_slope', 'c_icpt', 'c_r2', 'c_range', 'c_lod'].map(k => '<th class="n">' + t(k) + '</th>').join('') + '</tr>' +
    names.map(k => { const c = res.compounds[k]; return '<tr class="click' + (k === S.cal.sel ? ' rowsel' : '') + '" data-c="' + esc(k) + '"><td>' + esc(k) + '</td>' + n(c.n) + n(fmt(c.slope, 2)) + n(fmt(c.intercept, 1)) + n(fmt(c.r2, 4)) +
      n(c.min == null ? '–' : fmt(c.min, 1) + ' – ' + fmt(c.max, 1)) + n(fmt(c.lod, 2)) + '</tr>'; }).join('') + '</table>';
  drawCal();
}
function drawCal() {
  const res = S.cal.res, c = res && S.cal.sel && res.compounds[S.cal.sel];
  if (!c || !c.points.length) { plotCal.spec = null; const cv = $('#cvCal'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); return; }
  const css = k => plotCal.css(k), x1 = c.max * 1.1 || 1, series = [];
  if (c.slope != null) series.push({ x: [0, x1], y: [c.intercept, c.intercept + c.slope * x1], color: css('--muted'), width: 1.3, dash: [5, 4] });
  series.push({ x: c.points.map(q => q.conc), y: c.points.map(q => q.area), color: css('--c-uv'), points: true, label: S.cal.sel, dec: 1 });
  plotCal.set({ x0: 0, x1, xLabel: 'mg/l', xUnit: 'mg/l', xName: 'c', panes: [{ h: 1, left: { label: S.cal.sel + ' · ' + t('c_area'), min: 0 }, series }] });
}
async function saveCal() {
  const m = calMethod(), res = S.cal.res; if (!m || !res) return;
  m.calibration = { at: new Date().toISOString(), zero: res.zero, runs: res.runs, compounds: res.compounds };
  await Store.put('methods', m);
  if (S.editM && S.editM.id === m.id && !S.editDirty) S.editM = clone(m);
  await logAudit('calibration saved', m.name + ' · ' + Object.keys(res.compounds).filter(k => res.compounds[k].slope > 0).map(k => k + ' R² ' + (res.compounds[k].r2 == null ? '–' : res.compounds[k].r2.toFixed(4))).join(', '));
  renderCal(); toast(t('saved'));
}
async function addExampleStandards() {
  const m = clone(calMethod());
  for (const conc of [1, 5, 20]) {
    const d = simulateRun(m, { type: 'standard', conc }); d.uv = d.uv.map(v => +(v * 1000).toFixed(4));
    await storeRun({ id: uid(), name: 'Standard ' + conc + ' mg/l', type: 'standard', conc, vol: 20, site: '', methodId: m.id, method: m, device: 'sim', simulated: true, example: true, aborted: false, startedAt: new Date().toISOString(), data: d }, 'example run created');
  }
  renderCal();
}

/* ---------- System ---------- */
function renderConsole() { const c = $('#console'); c.textContent = S.console.join('\n'); c.scrollTop = c.scrollHeight; }
function renderAudit() {
  $('#auditTable').innerHTML = '<table><tr><th>' + t('au_when') + '</th><th>' + t('au_what') + '</th><th>' + t('au_detail') + '</th></tr>' +
    S.auditLog.slice(0, 200).map(a => '<tr><td>' + esc(dateStr(a.ts)) + '</td><td>' + esc(a.action) + '</td><td>' + esc(a.detail) + '</td></tr>').join('') + '</table>';
}

/* ---------- Navigation, Sprache, Start ---------- */
const TABS = ['messen', 'steuerung', 'methoden', 'sequenz', 'laeufe', 'auswertung', 'kalibrierung', 'system', 'bericht'];
function route() {
  const h = location.hash.replace('#', ''); S.tab = TABS.includes(h) ? h : 'messen';
  TABS.forEach(n => { $('#v-' + n).hidden = n !== S.tab; });
  document.querySelectorAll('#tabs a').forEach(a => { if (a.getAttribute('href') === '#' + S.tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (S.tab === 'methoden') { if (!S.editM) selectMethod(S.methods[0] && S.methods[0].id); else renderEditor(); }
  if (S.tab === 'auswertung') { if (!S.aRun && S.runs.length) openAnalysis(S.runs[0].id); else renderAnalysis(); }
  if (S.tab === 'kalibrierung') renderCal();
  if (S.tab === 'sequenz') renderSeq();
  if (S.tab === 'steuerung') renderCtl();
  if (S.tab === 'bericht') renderReport();
  if (S.tab === 'system') { renderConsole(); renderAudit(); }
  S.dirty = true;
}
function setLang(l) {
  LANG = l; try { localStorage.setItem('chromalog.lang', l); } catch (e) {}
  applyI18n(); $('#btnLang').textContent = l === 'de' ? 'EN' : 'DE'; $('#selLang').value = l;
  renderControls(); renderRuns(); fillRunSelect(); renderMethodList(); if (S.tab === 'methoden') renderEditor(); renderAnalysis(); renderAudit(); if (S.tab === 'kalibrierung') renderCal(); if (S.tab === 'sequenz') renderSeq(); if (S.tab === 'bericht') renderReport(); if (S.tab === 'steuerung') renderCtl(); S.dirty = true;
}
function frame() {
  if (S.dirty) { S.dirty = false; renderStatus(); if (S.tab === 'messen') drawLive(); if (S.tab === 'system') renderConsole(); if (S.tab === 'steuerung' || S.tab === 'messen') ctlLive(); }
  requestAnimationFrame(frame);
}
function bind() {
  window.addEventListener('hashchange', route);
  $('#btnLang').onclick = () => setLang(LANG === 'de' ? 'en' : 'de');
  $('#selLang').onchange = e => setLang(e.target.value);
  $('#btnStart').onclick = () => startRun();
  $('#btnAbort').onclick = () => { if (S.phase === 'run') finishRun(true, 'user'); else if (S.phase === 'equil') { S.phase = 'idle'; S.run = null; if (S.seq.running) seqEnd(false); renderControls(); S.dirty = true; } };
  $('#selType').onchange = renderControls;
  $('#selMethod').onchange = () => { cmd('RATE ' + curMethod().rate); S.dirty = true; };
  $('#btnFlow').onclick = () => mcmd('FLOW', (+$('#inFlow').value || 0).toFixed(3));
  $('#btnB').onclick = () => mcmd('PCTB', (+$('#inB').value || 0).toFixed(1));
  $('#btnLoad').onclick = () => mcmd('VALVE', 'LOAD');
  $('#btnInject').onclick = () => { if (S.dev && S.dev.kind === 'sim') S.dev.sample = { type: $('#selType').value, conc: +$('#inConc').value }; mcmd('VALVE', 'INJECT'); };
  $('#btnZero').onclick = () => cmd(S.stage1 ? 'n' : 'ZERO');
  $('#btnLed').onclick = () => { S.led = !S.led; cmd('LED ' + (S.led ? 1 : 0)); renderControls(); };
  $('#btnPumpStop').onclick = () => mcmd('STOP');
  $('#btnAuto').onclick = () => { S.view = { auto: true }; S.dirty = true; };
  $('#showGrad').onchange = () => { S.dirty = true; };
  $('#pane2Sel').onchange = () => { if (S.view.y) delete S.view.y[1]; S.dirty = true; };
  $('#mList').onclick = e => { const b = e.target.closest('button'); if (b) selectMethod(b.dataset.id); };
  $('#mNew').onclick = () => { S.editM = { id: uid(), name: LANG === 'de' ? 'Neue Methode' : 'New method', column: '', solventA: 'Wasser', solventB: 'Acetonitril', flow: 1, runtime: 10, rate: 10, pmax: 10, autozero: true, gradient: [{ t: 0, b: 5 }, { t: 10, b: 5 }], events: [], compounds: [] }; renderMethodList(); renderEditor(); markDirty(true); };
  $('#mDup').onclick = () => { if (!S.editM) return; S.editM = clone(S.editM); S.editM.id = uid(); S.editM.name += LANG === 'de' ? ' (Kopie)' : ' (copy)'; renderMethodList(); renderEditor(); markDirty(true); };
  $('#mDel').onclick = async () => {
    const m = S.editM; if (!m || S.methods.length < 2 || !S.methods.some(q => q.id === m.id)) return;
    if (!(await confirmDlg(t('del_method')))) return;
    S.methods = S.methods.filter(q => q.id !== m.id); await Store.del('methods', m.id); await logAudit('method deleted', m.name); fillMethodSelect(); selectMethod(S.methods[0].id);
  };
  $('#mEditor').addEventListener('input', editorEvent); $('#mEditor').addEventListener('change', editorEvent); $('#mEditor').addEventListener('click', editorClick);
  $('#runTable').onclick = runsClick;
  $('#runFile').onchange = e => { const f = e.target.files[0]; if (f) importRun(f); e.target.value = ''; };
  $('#aSel').onchange = e => openAnalysis(e.target.value);
  $('#aReint').onclick = integrate; $('#aSave').onclick = saveAnalysis;
  $('#aAuto').onclick = () => { S.aView = { auto: true }; drawAna(); };
  $('#aManual').onclick = () => { S.aManualMode = !S.aManualMode; renderAnalysis(); };
  $('#aClear').onclick = () => { S.aEdits = { manual: [], removed: [] }; integrate(); };
  plotAna.onRange = (a, b) => { S.aEdits.manual = S.aEdits.manual.filter(m => m.end < a || m.start > b); S.aEdits.manual.push({ start: a, end: b }); integrate(); };
  $('#peakTable').onclick = e => {
    const b = e.target.closest('button[data-rmpk]'); if (!b || !S.aRes) return;
    const pk = S.aRes.peaks[+b.dataset.rmpk]; if (!pk) return;
    if (pk.manual) S.aEdits.manual = S.aEdits.manual.filter(m => !(m.start === pk.mStart && m.end === pk.mEnd));
    else S.aEdits.removed.push({ start: pk.start, end: pk.end });
    integrate();
  };
  $('#aCompare').onchange = e => {
    const id = e.target.dataset.cmp; if (!id) return;
    if (e.target.checked) { if (S.aOverlay.length >= 5) { e.target.checked = false; return; } S.aOverlay.push(id); } else S.aOverlay = S.aOverlay.filter(q => q !== id);
    renderAnalysis();
  };
  $('#aCsv').onclick = () => { if (S.aRun) exportRun(S.aRun, 'csv'); };
  $('#cSel').onchange = () => { S.cal.excluded = {}; S.cal.sel = null; $('#cZero').checked = !!(calMethod().calibration && calMethod().calibration.zero); renderCal(); };
  $('#cZero').onchange = renderCal; $('#cSave').onclick = saveCal;
  $('#cRuns').addEventListener('change', e => { const id = e.target.dataset.run; if (id) { S.cal.excluded[id] = !e.target.checked; renderCal(); } });
  $('#cRuns').addEventListener('click', e => { if (e.target.id === 'cExample') addExampleStandards(); });
  $('#cTable').onclick = e => { const tr = e.target.closest('tr[data-c]'); if (tr) { S.cal.sel = tr.dataset.c; renderCal(); } };
  $('#aReport').onclick = openReport; $('#rBack').onclick = () => { location.hash = '#auswertung'; }; $('#rHtml').onclick = exportReport;
  $('#rPrint').onclick = () => { try { window.print(); } catch (e) {} };
  $('#qStart').onclick = seqStart; $('#qStop').onclick = () => { if (S.phase === 'run') finishRun(true, 'user'); else if (S.phase === 'equil') { S.phase = 'idle'; S.run = null; seqEnd(false); renderControls(); } else seqEnd(false); };
  $('#qConfirm').onchange = e => { S.seq.confirm = e.target.checked; seqSave(); };
  const newRow = (name, type, conc) => ({ name, type, conc: conc == null ? null : conc, vol: 20, methodId: curMethod().id, status: '', runId: null });
  $('#qAdd').onclick = () => { S.seq.rows.push(newRow((LANG === 'de' ? 'Probe ' : 'Sample ') + (S.seq.rows.filter(r => r.type === 'sample').length + 1), 'sample')); seqSave(); renderSeq(); };
  $('#qTemplate').onclick = () => { S.seq.rows.push(newRow(t('ty_blank'), 'blank'), newRow('Standard 1 mg/l', 'standard', 1), newRow('Standard 5 mg/l', 'standard', 5), newRow('Standard 20 mg/l', 'standard', 20), newRow((LANG === 'de' ? 'Probe 1' : 'Sample 1'), 'sample')); seqSave(); renderSeq(); };
  $('#qClear').onclick = () => { S.seq.rows = []; seqSave(); renderSeq(); };
  $('#qTable').addEventListener('change', e => {
    const el = e.target, row = S.seq.rows[+el.dataset.q]; if (!row || !el.dataset.k) return;
    row[el.dataset.k] = el.type === 'number' ? (el.value === '' ? null : +el.value) : el.value;
    if (el.dataset.k === 'type') { if (row.type === 'standard' && row.conc == null) row.conc = 5; renderSeq(); }
    seqSave();
  });
  $('#qTable').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.qrm) { S.seq.rows.splice(+b.dataset.qrm, 1); seqSave(); renderSeq(); }
    else if (b.dataset.qopen) { openAnalysis(b.dataset.qopen); location.hash = '#auswertung'; }
  });
  $('#btnConnect').onclick = () => connectDevice($('#selTr').value);
  $('#btnDisconnect').onclick = disconnectDevice;
  $('#selSpeed').onchange = e => { if (S.dev && S.dev.kind === 'sim') S.dev.speed = +e.target.value; };
  $('#cmdForm').onsubmit = e => { e.preventDefault(); const v = $('#cmdIn').value.trim(); if (v) { cmd(v); $('#cmdIn').value = ''; renderConsole(); } };
}
async function init() {
  try { LANG = localStorage.getItem('chromalog.lang') || ((navigator.language || 'de').startsWith('de') ? 'de' : 'en'); } catch (e) {}
  await Store.open();
  S.methods = await Store.all('methods');
  if (!S.methods.length) { S.methods = clone(DEFAULT_METHODS); for (const m of S.methods) await Store.put('methods', m); }
  S.runs = (await Store.all('runs')).sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  S.auditLog = (await Store.all('audit')).sort((a, b) => b.ts.localeCompare(a.ts));
  plotLive = new Plot($('#cvLive'), (a, b, y) => { S.view = newView(S.view, a, b, y); S.dirty = true; });
  plotAna = new Plot($('#cvAna'), (a, b, y) => { S.aView = newView(S.aView, a, b, y); drawAna(); });
  plotCal = new Plot($('#cvCal'));
  const st = document.createElement('style'); st.textContent = REPORT_CSS; document.head.appendChild(st);
  const sq = await Store.get('kv', 'sequence');
  if (sq && Array.isArray(sq.rows)) { S.seq.rows = sq.rows; S.seq.confirm = sq.confirm !== false; S.seq.rows.forEach(r => { if (r.status === 'running') r.status = 'aborted'; }); }
  fillMethodSelect(); bind();
  if (!S.runs.length) {
    const m = clone(S.methods[0]), d = simulateRun(m, { type: 'sample' });
    d.uv = d.uv.map(v => +(v * 1000).toFixed(4));
    await storeRun({ id: uid(), name: 'Kläranlagenablauf, dotiert', type: 'sample', conc: null, vol: 20, site: '', methodId: m.id, method: m, device: 'sim', simulated: true, example: true, aborted: false, startedAt: new Date().toISOString(), data: d }, 'example run created');
  }
  await ctlInit();
  setLang(LANG); route(); requestAnimationFrame(frame);
  if (!Store.persistent) toast(t('t_storage'), true);
  if (isNativeApp()) { document.documentElement.classList.add('native'); $('#rPrint').hidden = true; capP('KeepAwake', 'keepAwake').catch(() => {}); }   /* Android-App: Bildschirm bleibt an, sonst hält Android die Aufzeichnung an */
  await connectDevice('sim');
}
init();
