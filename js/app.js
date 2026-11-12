'use strict';
/* ChromaLog – Ablaufsteuerung und Oberfläche */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const CH = ['uv', 'cond', 'press', 'temp', 'flow', 'b'];

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
  console: [], dirty: true, tab: 'messen'
};
let plotLive, plotAna, plotGrad;

/* ---------- kleine Helfer ---------- */
let toastTimer;
function toast(msg, crit) { const e = $('#toast'); e.textContent = msg; e.className = 'show' + (crit ? ' crit' : ''); clearTimeout(toastTimer); toastTimer = setTimeout(() => { e.className = ''; }, crit ? 7000 : 3500); }
function confirmDlg(text) {
  return new Promise(res => {
    const d = $('#dlg'); $('#dlgText').textContent = text; $('#dlgYes').textContent = t('yes'); $('#dlgNo').textContent = t('no');
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
async function connectDevice(kind) {
  if (S.phase !== 'idle') return;
  if (kind === 'usb' && !('serial' in navigator)) { $('#connHint').textContent = t('usb_unsupported'); return; }
  if (kind === 'ble' && !('bluetooth' in navigator)) { $('#connHint').textContent = t('ble_unsupported'); return; }
  await disconnectDevice();
  const dev = kind === 'usb' ? new SerialDevice(+$('#selBaud').value) : kind === 'ble' ? new BleDevice() : new SimDevice();
  dev.onLine = onLine;
  dev.onClose = () => { if (S.dev === dev) { S.dev = null; S.last = null; if (S.phase !== 'idle') finishRun(true); toast(t('conn_lost'), true); logAudit('disconnect', 'lost'); S.dirty = true; } };
  try { await dev.connect(); }
  catch (e) {
    if (e && e.name === 'NotFoundError') return;
    $('#connHint').textContent = (e && e.name === 'SecurityError') ? t(kind === 'ble' ? 'ble_blocked' : 'usb_blocked') : t('conn_failed') + ' ' + (e && e.message || '');
    return;
  }
  S.dev = dev; S.stage1 = false; S.last = null; $('#connHint').textContent = '';
  CH.concat('t').forEach(k => { if (S.mon[k]) S.mon[k].length = 0; });
  if (kind === 'sim') dev.speed = +$('#selSpeed').value;
  cmd('RATE ' + curMethod().rate);
  logAudit('connect', kind + (dev.name ? ' ' + dev.name : ''));
  S.dirty = true;
}
async function disconnectDevice() { if (S.dev) { const d = S.dev; S.dev = null; S.last = null; try { await d.close(); } catch (e) {} logAudit('disconnect', d.kind); S.dirty = true; } }

function onLine(line) {
  const s = parseLine(line);
  if (!s) { if (line.trim()) log(line); return; }
  if (S.tab === 'system') log(line);
  if (s.kind === 'stage1' && !S.stage1) { S.stage1 = true; toast(t('t_stage1')); }
  if (s.uv != null) s.uv *= 1000;                       /* intern in mAU */
  S.last = s;
  const m = S.mon; m.t.push(s.t); m.uv.push(s.uv); m.cond.push(s.cond); m.press.push(s.press); m.temp.push(s.temp); m.b.push(s.b);
  if (m.t.length > 9000) Object.keys(m).forEach(k => m[k].splice(0, 1500));
  if (S.phase === 'equil') {
    const r = S.run, me = r.method;
    if (r.tEq == null) r.tEq = s.t;
    const ready = s.b == null || (Math.abs(s.b - gradAt(me, 0)) < 0.6 && (s.flow == null || Math.abs(s.flow - me.flow) < 0.05));
    if ((ready && s.t - r.tEq >= 3) || s.t - r.tEq > 240) beginRun(s);
  } else if (S.phase === 'run') {
    const r = S.run, me = r.method, tm = (s.t - r.t0) / 60, d = r.data;
    d.t.push(+tm.toFixed(5)); CH.forEach(k => d[k].push(s[k] == null ? null : +s[k].toFixed(4)));
    const b = gradAt(me, tm);
    if (Math.abs(b - r.lastB) >= 0.1) { r.lastB = b; cmd('PCTB ' + b.toFixed(1)); }
    (me.events || []).forEach((ev, i) => { if (!r.evDone[i] && tm >= ev.t) { r.evDone[i] = true; cmd('VALVE ' + ev.pos); } });
    if (s.press != null && s.press > me.pmax) { cmd('STOP'); toast(t('t_overp'), true); finishRun(true, 'overpressure'); }
    else if (tm >= me.runtime) finishRun(false);
  }
  S.dirty = true;
}

/* ---------- Lauf ---------- */
function startRun() {
  if (!S.dev) { toast(t('t_noconn'), true); return; }
  if (S.phase !== 'idle') return;
  const m = clone(curMethod()), type = $('#selType').value;
  S.run = {
    id: uid(), name: $('#inName').value.trim() || 'Probe', type, conc: type === 'standard' ? +$('#inConc').value : null, vol: +$('#inVol').value, site: $('#inSite').value.trim(),
    methodId: m.id, method: m, device: S.dev.kind, simulated: S.dev.kind === 'sim', aborted: false, startedAt: null,
    data: { t: [], uv: [], cond: [], press: [], temp: [], flow: [], b: [] }, tEq: null, t0: 0, lastB: gradAt(m, 0), evDone: {}
  };
  if (S.dev.kind === 'sim') S.dev.sample = { type, conc: S.run.conc };
  cmd('LED 1'); S.led = true; cmd('RATE ' + m.rate); cmd('FLOW ' + m.flow.toFixed(3)); cmd('PCTB ' + S.run.lastB.toFixed(1)); cmd('VALVE LOAD');
  S.phase = 'equil'; S.view = { auto: true }; S.dirty = true; renderControls();
}
function beginRun(s) {
  const r = S.run;
  if (r.method.autozero) cmd(S.stage1 ? 'n' : 'ZERO');
  cmd('VALVE INJECT');
  r.t0 = s.t; r.startedAt = new Date().toISOString(); S.phase = 'run'; S.view = { auto: true }; renderControls();
}
async function finishRun(aborted, reason) {
  const r = S.run; if (!r) return;
  const wasRun = S.phase === 'run';
  S.phase = 'idle'; S.run = null; renderControls(); S.dirty = true;
  cmd('VALVE LOAD'); if (reason !== 'overpressure') cmd('PCTB ' + gradAt(r.method, 0).toFixed(1));
  if (!wasRun || r.data.t.length < 5) return;
  const rec = { id: r.id, name: r.name, type: r.type, conc: r.conc, vol: r.vol, site: r.site, methodId: r.methodId, method: r.method, device: r.device,
    simulated: r.simulated, aborted: !!aborted, reason: reason || '', startedAt: r.startedAt, data: r.data };
  await storeRun(rec, aborted ? 'run aborted' : 'run finished');
  toast(t('t_runsaved'));
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
  $('#btnStart').disabled = !idle; $('#btnAbort').disabled = idle;
  ['#btnFlow', '#btnB', '#btnLoad', '#btnInject', '#btnZero', '#btnLed', '#btnPumpStop', '#selMethod'].forEach(q => { $(q).disabled = !idle; });
  $('#manLocked').hidden = idle;
  $('#btnLed').textContent = t(S.led ? 'led_off' : 'led_on');
  $('#inConc').disabled = $('#selType').value !== 'standard';
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
    { h: 3, left: { label: t('ch_uv') + ' [mAU]', minSpan: 5 }, right: showB ? { min: 0, max: 100, label: '%B', color: css('--c-grad') } : null, series: top },
    { h: 1, left: { label: t(p2.label) + ' [' + p2.unit + ']', minSpan: p2.span }, series: [{ x, y: d[key], color: css(p2.color), width: 1.3, label: t(p2.label), dec: p2.dec }] }
  ] });
}

/* ---------- Methoden ---------- */
function fillMethodSelect() { const cur = $('#selMethod').value; $('#selMethod').innerHTML = S.methods.map(m => '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>').join(''); if (S.methods.some(m => m.id === cur)) $('#selMethod').value = cur; }
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
  const i = S.methods.findIndex(q => q.id === m.id), copy = clone(m);
  if (i >= 0) S.methods[i] = copy; else S.methods.push(copy);
  await Store.put('methods', copy); await logAudit('method saved', m.name);
  fillMethodSelect(); renderMethodList(); renderEditor(); markDirty(false); toast(t('saved'));
}

/* ---------- Läufe ---------- */
function renderRuns() {
  if (!S.runs.length) { $('#runTable').innerHTML = '<p class="hint">' + t('r_none') + '</p>'; return; }
  $('#runTable').innerHTML = '<table><tr><th>' + t('r_name') + '</th><th>' + t('type') + '</th><th>' + t('r_date') + '</th><th>' + t('method') + '</th><th class="n">' + t('r_dur') + '</th><th class="n">' + t('r_peaks') + '</th><th></th></tr>' +
    S.runs.map(r => '<tr><td>' + esc(r.name) + (r.example ? '<span class="badge">' + t('r_example') + '</span>' : r.simulated ? '<span class="badge">' + t('r_sim') + '</span>' : '') + (r.aborted ? '<span class="badge crit">' + t('r_aborted') + '</span>' : '') + '</td>' +
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
    await storeRun(r, 'run imported'); toast(t('t_imported'));
  } catch (e) { toast(t('t_badfile'), true); }
}

/* ---------- Auswertung ---------- */
function fillRunSelect() { $('#aSel').innerHTML = S.runs.map(r => '<option value="' + r.id + '">' + esc(r.name + ' · ' + dateStr(r.startedAt)) + '</option>').join(''); if (S.aRun) $('#aSel').value = S.aRun.id; }
function openAnalysis(id) {
  const r = S.runs.find(q => q.id === id); if (!r) return;
  S.aRun = r; S.aView = { auto: true };
  const p = (r.analysis && r.analysis.params) || ANALYSIS_DEFAULTS;
  $('#aSn').value = p.sn; $('#aMinW').value = p.minWidth; $('#aBase').value = p.baseWin; $('#aSmooth').value = p.smooth;
  integrate(); fillRunSelect();
}
function integrate() {
  const r = S.aRun; if (!r) return;
  const p = { sn: +$('#aSn').value || 5, minWidth: +$('#aMinW').value || 3, baseWin: +$('#aBase').value || 1.5, smooth: +$('#aSmooth').value || 0 };
  S.aRes = analyze(r.data.t, r.data.uv, p, r.method.compounds); renderAnalysis();
}
function renderAnalysis() {
  const r = S.aRun, res = S.aRes;
  if (!r || !res) { $('#peakTable').innerHTML = '<p class="hint">' + t('a_none') + '</p>'; $('#aMeta').innerHTML = ''; if (plotAna) { plotAna.spec = null; const c = $('#cvAna'); c.getContext('2d').clearRect(0, 0, c.width, c.height); } return; }
  const n = v => '<td class="n">' + v + '</td>';
  $('#peakTable').innerHTML = !res.peaks.length ? '<p class="hint">' + t('a_nopeaks') + '</p>' :
    '<table><tr><th class="n">#</th><th>' + t('p_name') + '</th>' + ['p_rt', 'p_area', 'p_areap', 'p_height', 'p_w', 'p_n', 'p_tail', 'p_rs', 'p_sn'].map(k => '<th class="n">' + t(k) + '</th>').join('') + '</tr>' +
    res.peaks.map((p, i) => '<tr>' + n(i + 1) + '<td>' + (p.name ? esc(p.name) : '<span class="hint">' + t('unknown') + '</span>') + '</td>' + n(fmt(p.rt, 3)) + n(fmt(p.area, 1)) + n(fmt(p.areaPct, 1)) + n(fmt(p.height, 2)) +
      n(fmt(p.w50, 1)) + n(fmt(p.plates, 0)) + n(fmt(p.tailing, 2)) + n(fmt(p.rs, 1)) + n(fmt(p.sn, 0)) + '</tr>').join('') + '</table>';
  const row = (k, v, mono) => '<dt>' + t(k) + '</dt><dd' + (mono ? ' class="mono"' : '') + '>' + v + '</dd>';
  $('#aMeta').innerHTML = row('sample', esc(r.name) + ' (' + t('ty_' + r.type) + (r.conc != null ? ', ' + fmt(r.conc, 1) + ' mg/l' : '') + ')') + row('method', esc(r.method.name)) + row('a_started', esc(dateStr(r.startedAt))) +
    (r.site ? row('site', esc(r.site)) : '') + row('vol', fmt(r.vol, 0) + ' µl') + row('a_points', fmt(r.data.t.length, 0)) + row('a_noise', fmt(res.noise, 3) + ' mAU') + row('a_hash', r.hash ? r.hash.slice(0, 16) + '…' : '–', true);
  drawAna();
}
function drawAna() {
  const r = S.aRun, res = S.aRes; if (!r || !res || S.tab !== 'auswertung') return;
  const css = n => plotAna.css(n), d = r.data;
  let x0 = 0, x1 = Math.max(d.t[d.t.length - 1] || 1, 0.1); if (!S.aView.auto) { x0 = S.aView.x0; x1 = S.aView.x1; }
  const peaks = res.peaks.map(p => ({ start: p.start, end: p.end, yStart: p.yStart, yEnd: p.yEnd, rt: p.rt, name: p.name, yApex: d.uv[Math.min(d.uv.length - 1, lowerBound(d.t, p.rt))] }));
  plotAna.set({ x0, x1, xLabel: t('min'), xUnit: t('min'), panes: [
    { h: 3, left: { label: t('ch_uv') + ' [mAU]', minSpan: 5 }, series: [{ x: d.t, y: d.uv, color: css('--c-uv'), width: 1.5, label: 'UV', dec: 2 }], peaks },
    { h: 1, left: { label: t('ch_press') + ' [bar]', minSpan: 1 }, right: { min: 0, max: 100, label: '%B', color: css('--c-grad') },
      series: [{ x: d.t, y: d.press, color: css('--c-press'), width: 1.3, label: t('ch_press'), dec: 2 }, { x: d.t, y: d.b, color: css('--c-grad'), axis: 'R', width: 1.2, label: '%B', dec: 1 }] }
  ] });
}
async function saveAnalysis() {
  const r = S.aRun, res = S.aRes; if (!r || !res) return;
  r.analysis = { params: res.params, peaks: res.peaks, noise: res.noise, at: new Date().toISOString(), auto: false };
  await Store.put('runs', r); await logAudit('analysis saved', r.name + ' · ' + res.peaks.length + ' peaks · S/N ' + res.params.sn);
  renderRuns(); toast(t('saved'));
}

/* ---------- System ---------- */
function renderConsole() { const c = $('#console'); c.textContent = S.console.join('\n'); c.scrollTop = c.scrollHeight; }
function renderAudit() {
  $('#auditTable').innerHTML = '<table><tr><th>' + t('au_when') + '</th><th>' + t('au_what') + '</th><th>' + t('au_detail') + '</th></tr>' +
    S.auditLog.slice(0, 200).map(a => '<tr><td>' + esc(dateStr(a.ts)) + '</td><td>' + esc(a.action) + '</td><td>' + esc(a.detail) + '</td></tr>').join('') + '</table>';
}

/* ---------- Navigation, Sprache, Start ---------- */
const TABS = ['messen', 'methoden', 'laeufe', 'auswertung', 'system'];
function route() {
  const h = location.hash.replace('#', ''); S.tab = TABS.includes(h) ? h : 'messen';
  TABS.forEach(n => { $('#v-' + n).hidden = n !== S.tab; });
  document.querySelectorAll('#tabs a').forEach(a => { if (a.getAttribute('href') === '#' + S.tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (S.tab === 'methoden') { if (!S.editM) selectMethod(S.methods[0] && S.methods[0].id); else renderEditor(); }
  if (S.tab === 'auswertung') { if (!S.aRun && S.runs.length) openAnalysis(S.runs[0].id); else renderAnalysis(); }
  if (S.tab === 'system') { renderConsole(); renderAudit(); }
  S.dirty = true;
}
function setLang(l) {
  LANG = l; try { localStorage.setItem('chromalog.lang', l); } catch (e) {}
  applyI18n(); $('#btnLang').textContent = l === 'de' ? 'EN' : 'DE'; $('#selLang').value = l;
  renderControls(); renderRuns(); fillRunSelect(); renderMethodList(); if (S.tab === 'methoden') renderEditor(); renderAnalysis(); renderAudit(); S.dirty = true;
}
function frame() {
  if (S.dirty) { S.dirty = false; renderStatus(); if (S.tab === 'messen') drawLive(); if (S.tab === 'system') renderConsole(); }
  requestAnimationFrame(frame);
}
function bind() {
  window.addEventListener('hashchange', route);
  $('#btnLang').onclick = () => setLang(LANG === 'de' ? 'en' : 'de');
  $('#selLang').onchange = e => setLang(e.target.value);
  $('#btnStart').onclick = startRun;
  $('#btnAbort').onclick = () => { if (S.phase === 'run') finishRun(true, 'user'); else if (S.phase === 'equil') { S.phase = 'idle'; S.run = null; renderControls(); S.dirty = true; } };
  $('#selType').onchange = renderControls;
  $('#selMethod').onchange = () => { cmd('RATE ' + curMethod().rate); S.dirty = true; };
  $('#btnFlow').onclick = () => cmd('FLOW ' + (+$('#inFlow').value || 0).toFixed(3));
  $('#btnB').onclick = () => cmd('PCTB ' + (+$('#inB').value || 0).toFixed(1));
  $('#btnLoad').onclick = () => cmd('VALVE LOAD');
  $('#btnInject').onclick = () => { if (S.dev && S.dev.kind === 'sim') S.dev.sample = { type: $('#selType').value, conc: +$('#inConc').value }; cmd('VALVE INJECT'); };
  $('#btnZero').onclick = () => cmd(S.stage1 ? 'n' : 'ZERO');
  $('#btnLed').onclick = () => { S.led = !S.led; cmd('LED ' + (S.led ? 1 : 0)); renderControls(); };
  $('#btnPumpStop').onclick = () => cmd('STOP');
  $('#btnAuto').onclick = () => { S.view = { auto: true }; S.dirty = true; };
  $('#showGrad').onchange = $('#pane2Sel').onchange = () => { S.dirty = true; };
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
  $('#aCsv').onclick = () => { if (S.aRun) exportRun(S.aRun, 'csv'); };
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
  plotLive = new Plot($('#cvLive'), (a, b) => { S.view = a == null ? { auto: true } : { auto: false, x0: a, x1: b }; S.dirty = true; });
  plotAna = new Plot($('#cvAna'), (a, b) => { S.aView = a == null ? { auto: true } : { auto: false, x0: a, x1: b }; drawAna(); });
  fillMethodSelect(); bind();
  if (!S.runs.length) {
    const m = clone(S.methods[0]), d = simulateRun(m, { type: 'sample' });
    d.uv = d.uv.map(v => +(v * 1000).toFixed(4));
    await storeRun({ id: uid(), name: 'Kläranlagenablauf, dotiert', type: 'sample', conc: null, vol: 20, site: '', methodId: m.id, method: m, device: 'sim', simulated: true, example: true, aborted: false, startedAt: new Date().toISOString(), data: d }, 'example run created');
  }
  setLang(LANG); route(); requestAnimationFrame(frame);
  if (!Store.persistent) toast(t('t_storage'), true);
  await connectDevice('sim');
}
init();
