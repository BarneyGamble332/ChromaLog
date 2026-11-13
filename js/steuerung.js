'use strict';
/* Reiter „Steuerung“: Fließbild mit frei angelegten Bauteilen, Leitungen und einfachen Abläufen. */
const CTL = { layouts: [], cur: null, edit: false, linkFrom: null, values: {}, meas: {}, hist: {}, log: [], run: null, procId: null, lastHist: 0 };
const ctlL = () => CTL.layouts.find(l => l.id === CTL.cur) || CTL.layouts[0];
const ctlById = id => ctlL().parts.find(p => p.id === id);
const ctlByKey = key => ctlL().parts.find(p => p.key === key);

function ctlMake(lib, x, y, over) {
  const e = CTL_LIB.find(q => q.lib === lib), p = clone(e);
  p.name = LANG === 'de' ? e.de : e.en; delete p.de; delete p.en; delete p.group;
  return Object.assign(p, { id: uid(), x, y }, over || {});
}
function ctlDefaults() {
  const a = { flow: ctlMake('flow', 40, 40, { name: 'Pumpe (Fluss gesamt)' }), b: ctlMake('pctb', 40, 260, { name: 'Anteil B' }), press: ctlMake('press', 320, 40, { name: 'Drucksensor', source: 'D:press', scale: null, offset: null, fw: null, pin: '' }), inj: ctlMake('inj', 600, 40, { name: 'Injektionsventil' }),
    heat: ctlMake('heater', 880, 40, { name: 'Säulenheizung' }), uv: ctlMake('uv', 1160, 40, { name: 'UV-Detektor' }), led: ctlMake('uvled', 1160, 230), zero: ctlMake('zero', 1160, 400),
    temp: ctlMake('ds18', 600, 260), syr: ctlMake('syringe', 320, 260, { name: 'Spritzenpumpe A (Beispiel)', key: 'pumpea' }) };
  const s1 = { led: ctlMake('uvled', 40, 40), zero: ctlMake('zero', 40, 220), uv: ctlMake('uv', 320, 40, { name: 'Extinktion' }), temp: ctlMake('ds18', 320, 220) };
  return [
    { id: uid(), name: 'Mini-HPLC (Simulator)', parts: Object.values(a), links: [[a.flow, a.press], [a.press, a.inj], [a.inj, a.heat], [a.heat, a.uv]].map(l => ({ from: l[0].id, to: l[1].id })),
      procs: [{ id: uid(), name: 'Anfahren und injizieren', steps: [{ type: 'set', key: 'fluss', value: '1' }, { type: 'until', src: 'D:press', op: '>', value: 5, timeout: 60 }, { type: 'set', key: 'led', value: '1' },
        { type: 'wait', sec: 10 }, { type: 'set', key: 'zero', value: '' }, { type: 'set', key: 'inj', value: 'INJECT' }, { type: 'wait', sec: 20 }, { type: 'set', key: 'inj', value: 'LOAD' }] }] },
    { id: uid(), name: 'Stufe 1 – UV-Detektor', parts: Object.values(s1), links: [{ from: s1.led.id, to: s1.uv.id }], procs: [] }
  ];
}
function ctlSave() { Store.put('kv', { id: 'control', cur: CTL.cur, layouts: CTL.layouts }); }
function ctlConfigure(clear) { if (!S.dev || !CTL.layouts.length) return; if (clear) cmd('CLEAR'); configCommands(ctlL().parts).forEach(c => cmd(c)); }
function ctlValue(key, v) { CTL.meas[key] = v; }
function ctlLogLine(text) {
  CTL.log.push(new Date().toLocaleTimeString(LANG === 'de' ? 'de-DE' : 'en-GB') + '  ' + text);
  if (CTL.log.length > 60) CTL.log.splice(0, CTL.log.length - 60);
  if (S.tab === 'steuerung') ctlRenderLog();
}
function ctlRenderLog() { const e = $('#ctlLog'); e.textContent = CTL.log.length ? CTL.log.join('\n') : t('ctl_nolog'); e.scrollTop = e.scrollHeight; }
function ctlSend(p, v) {
  if (!S.dev) { toast(t('t_noconn'), true); return false; }
  if (S.phase !== 'idle') { toast(t('ctl_runlock'), true); return false; }
  CTL.values[p.key] = v; const c = partCommand(p, v); cmd(c); ctlLogLine(c); return true;
}
function ctlStopAll(byDevice) {
  if (CTL.run) ctlProcEnd('stopped');
  if (S.seq.running) seqEnd(false);
  if (S.phase === 'run') finishRun(true, 'user'); else if (S.phase === 'equil') { S.phase = 'idle'; S.run = null; renderControls(); }
  safeCommands(ctlL().parts).forEach(s => { CTL.values[s.key] = s.value; cmd(s.cmd); ctlLogLine(s.cmd); });
  cmd('STOP'); ctlLogLine('STOP'); logAudit('stop all', ctlL().name + (byDevice ? ' · ' + byDevice : '')); toast(byDevice ? t('ctl_devstop') + ' ' + byDevice : t('ctl_stopped'), true); if (S.tab === 'steuerung') renderCtl();
}

/* ---------- Kacheln ---------- */
function ctlNodeHtml(p) {
  let v = CTL.values[p.key]; const on = (c) => c ? ' on' : '';
  if (v == null && p.fb && S.last && S.last[p.fb] != null) v = typeof S.last[p.fb] === 'number' ? Math.round(S.last[p.fb] / (p.step || 1)) * (p.step || 1) : S.last[p.fb];   /* Rückmeldung des Geräts */
  const seg = opts => '<div class="seg">' + opts.map(o => '<button type="button" class="btn' + on(v != null && String(v) === String(o.value)) + '" data-act="set" data-v="' + esc(o.value) + '">' + esc(o.name) + '</button>').join('') + '</div>';
  let b = '';
  if (p.kind === 'switch') b = seg([{ name: p.off || t('ctl_off'), value: '0' }, { name: p.on || t('ctl_on'), value: '1' }]);
  else if (p.kind === 'button') b = '<button type="button" class="btn" data-act="set" data-v="">' + esc(p.name) + '</button>';
  else if (p.kind === 'positions') b = seg(p.positions || []);
  else if (p.kind === 'slider') { const cur = v != null ? +v : Math.min(Math.max(0, p.min), p.max);
    b = '<div class="rowv"><input type="range" data-act="range" min="' + p.min + '" max="' + p.max + '" step="' + (p.step || 1) + '" value="' + cur + '" aria-label="' + esc(p.name) + '"><span class="val"><span data-val>' + fmt(cur, decOf(p.step)) + '</span> ' + esc(p.unit || '') + '</span></div>' +
      (p.stop ? '<button type="button" class="btn danger" data-act="set" data-v="0">' + t('ctl_stop') + '</button>' : ''); }
  else if (p.kind === 'syringe') b = '<div class="rowv"><input type="number" data-role="value" step="' + (p.step || 0.05) + '" min="0" value="' + (p.value != null ? p.value : 0.5) + '" aria-label="' + esc(p.name) + '"><span class="lbl">' + esc(p.unit || 'ml/min') + '</span></div>' +
      '<div class="seg"><button type="button" class="btn' + on(+v > 0) + '" data-act="deliver">' + t('ctl_deliver') + '</button><button type="button" class="btn' + on(+v < 0) + '" data-act="fill">' + t('ctl_fill') + '</button><button type="button" class="btn danger" data-act="set" data-v="0">' + t('ctl_stop') + '</button></div>' +
      '<div class="barrow"><div class="bar"><i data-bar style="width:0%"></i></div><span class="lbl" data-live>–</span></div>';
  else if (p.kind === 'heater') b = '<div class="rowv"><span class="lbl">' + t('ctl_setpoint') + '</span><input type="number" data-role="value" step="' + (p.step || 1) + '" min="' + p.min + '" max="' + p.max + '" value="' + (p.value != null ? p.value : 40) + '" aria-label="' + esc(p.name) + '"><span class="lbl">°C</span></div>' +
      '<div class="seg"><button type="button" class="btn' + on(v != null && +v === 0) + '" data-act="set" data-v="0">' + t('ctl_off') + '</button><button type="button" class="btn' + on(+v > 0) + '" data-act="heat">' + t('ctl_on') + '</button></div>' +
      '<div class="big"><span data-live>–</span><span class="u">°C ' + t('ctl_actual') + '</span></div>';
  else b = '<div class="rowv" style="justify-content:space-between"><div class="big"><span data-live>–</span><span class="u">' + esc(p.unit || '') + '</span></div><svg class="spark" viewBox="0 0 84 30" aria-hidden="true"><polyline data-spark points=""/></svg></div>';
  const foot = (p.pin ? 'Pin ' + p.pin + ' · ' : '') + (p.kind === 'display' ? (p.source || '') : partCommand(p, p.kind === 'button' ? '' : '‹' + (LANG === 'de' ? 'wert' : 'value') + '›'));
  const eb = CTL.edit ? '<div class="ne"><button type="button" class="btn small" data-act="link">' + t('ctl_link') + '</button><button type="button" class="btn small" data-act="edit">' + t('ctl_change') + '</button><button type="button" class="btn small danger" data-act="del" aria-label="' + t('m_del') + '">✕</button></div>' : '';
  return '<div class="node' + (CTL.linkFrom === p.id ? ' linkfrom' : '') + '" data-id="' + p.id + '" style="left:' + p.x + 'px;top:' + p.y + 'px"><div class="nh"><div><div class="nn">' + esc(p.name) + '</div><div class="nt">' + t('k_' + p.kind) + '</div></div></div>' +
    eb + '<div class="nb">' + b + '</div><div class="nf">' + esc(foot) + '</div></div>';
}
const decOf = step => { const s = String(step || 1); return s.indexOf('.') < 0 ? 0 : Math.min(3, s.length - s.indexOf('.') - 1); };
function ctlRenderNodes() {
  const inner = $('#flowInner'), L = ctlL();
  inner.querySelectorAll('.node').forEach(n => n.remove());
  inner.insertAdjacentHTML('beforeend', L.parts.map(ctlNodeHtml).join(''));
  ctlSize(); ctlDrawLinks(); ctlLive();
}
function ctlSize() {
  const L = ctlL(), inner = $('#flowInner');
  inner.style.width = Math.max(1100, ...L.parts.map(p => p.x + 420)) + 'px'; inner.style.height = Math.max(620, ...L.parts.map(p => p.y + 460)) + 'px';
}
function ctlDrawLinks() {
  const L = ctlL(), rect = {};
  document.querySelectorAll('#flowInner .node').forEach(n => { const p = ctlById(n.dataset.id); if (p) rect[p.id] = { x: p.x, y: p.y, w: n.offsetWidth || 224, h: n.offsetHeight || 120 }; });
  $('#flowSvg').innerHTML = '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" style="fill:var(--muted)"/></marker></defs>' +
    (L.links || []).map((l, i) => { if (!rect[l.from] || !rect[l.to]) return ''; const d = linkPath(rect[l.from], rect[l.to]); return '<g><path class="hit" data-i="' + i + '" d="' + d + '"/><path class="pipe" d="' + d + '" marker-end="url(#arr)"/></g>'; }).join('');
}
function ctlLive() {
  if (!CTL.fbDone && S.last) { CTL.fbDone = true; ctlRenderNodes(); return; }
  const L = ctlL(), now = performance.now(), tickHist = now - CTL.lastHist >= 1000; if (tickHist) CTL.lastHist = now;
  document.querySelectorAll('#flowInner .node').forEach(n => {
    const p = ctlById(n.dataset.id); if (!p) return; const live = n.querySelector('[data-live]'); if (!live) return;
    if (p.kind === 'display') {
      const val = partReading(p, S.last, CTL.meas); live.textContent = fmt(val, p.dec == null ? 2 : p.dec);
      const h = CTL.hist[p.id] || (CTL.hist[p.id] = []);
      if (tickHist && val != null) { h.push(val); if (h.length > 60) h.shift(); }
      const sp = n.querySelector('[data-spark]');
      if (sp && h.length > 1) { const lo = Math.min(...h), hi = Math.max(...h), sc = hi - lo || 1; sp.setAttribute('points', h.map((q, i) => (i * 84 / 59).toFixed(1) + ',' + (27 - (q - lo) / sc * 24).toFixed(1)).join(' ')); }
    } else if (p.kind === 'syringe') {
      const vol = CTL.meas[p.key]; live.textContent = t('ctl_level') + ' ' + fmt(vol, 1) + ' ' + t('ctl_of') + ' ' + fmt(p.max, 0) + ' ml';
      n.querySelector('[data-bar]').style.width = (vol == null ? 0 : Math.max(0, Math.min(100, vol / p.max * 100))).toFixed(0) + '%';
    } else if (p.kind === 'heater') live.textContent = fmt(CTL.meas[p.key], 1);
  });
}
function renderCtl() {
  if (!CTL.layouts.length) return;
  const L = ctlL();
  $('#ctlSel').innerHTML = CTL.layouts.map(l => '<option value="' + l.id + '"' + (l.id === L.id ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('');
  $('#ctlEdit').textContent = t(CTL.edit ? 'ctl_done' : 'ctl_edit'); $('#ctlEdit').classList.toggle('on', CTL.edit);
  $('#ctlEditBar').hidden = !CTL.edit; $('#ctlName').value = L.name; $('#ctlDel').disabled = CTL.layouts.length < 2;
  $('#ctlHint').textContent = CTL.linkFrom ? t('ctl_link_pick') : (L.parts.length ? t(CTL.edit ? 'ctl_edit_hint' : 'ctl_use_hint') : t('ctl_empty'));
  $('#flow').classList.toggle('editing', CTL.edit); $('#flow').classList.toggle('linking', !!CTL.linkFrom);
  ctlRenderNodes(); renderProc(); ctlRenderLog();
}

/* ---------- Bibliothek und Bauteil-Dialog ---------- */
function ctlOpenLib() {
  const d = $('#libDlg'), groups = ['pumps', 'valves', 'heat', 'det', 'sens', 'hplc', 'free'];
  d.innerHTML = '<h3>' + t('ctl_lib') + '</h3>' + groups.map(g => '<div class="libgroup">' + t('g_' + g) + '</div><div class="libgrid">' +
    CTL_LIB.filter(e => e.group === g).map(e => '<button type="button" data-lib="' + e.lib + '">' + esc(LANG === 'de' ? e.de : e.en) + '<small>' + t('k_' + e.kind) + '</small></button>').join('') + '</div>').join('') +
    '<div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-close="1">' + t('cancel') + '</button></div>';
  d.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    d.close(); if (!b.dataset.lib) return;
    const L = ctlL(), f = $('#flow'); let x = Math.round((f.scrollLeft + 40) / 10) * 10, y = Math.round((f.scrollTop + 40) / 10) * 10;
    while (L.parts.some(p => Math.abs(p.x - x) < 30 && Math.abs(p.y - y) < 30)) { x += 30; y += 30; }
    const p = ctlMake(b.dataset.lib, x, y); p.key = uniqueKey(p.key, L.parts); L.parts.push(p); CTL.edit = true; ctlSave(); renderCtl(); ctlOpenPart(p, true);
  };
  d.showModal();
}
const CTL_FIELDS = [
  { k: 'name', l: 'm_name' }, { k: 'key', l: 'ctl_key' }, { k: 'kind', l: 'ctl_kind', sel: true }, { k: 'pin', l: 'ctl_pin' }, { k: 'fw', l: 'ctl_fw', fwsel: true },
  { k: 'spm', l: 'ctl_spm', num: true, kinds: ['syringe', 'slider'] }, { k: 'role', l: 'ctl_role', rolesel: true, kinds: ['syringe', 'slider', 'positions'] },
  { k: 'target', l: 'ctl_target', kinds: ['display'] }, { k: 'tdir', l: 'ctl_tdir', num: true, kinds: ['display'] }, { k: 'scale', l: 'ctl_scale', num: true, kinds: ['display'] }, { k: 'offset', l: 'ctl_offset', num: true, kinds: ['display'] },
  { k: 'min', l: 'ctl_min', num: true, kinds: ['slider', 'heater'] }, { k: 'max', l: 'ctl_max', num: true, kinds: ['slider', 'heater'] }, { k: 'max', l: 'ctl_max_syr', num: true, kinds: ['syringe'] },
  { k: 'step', l: 'ctl_step', num: true, kinds: ['slider', 'syringe', 'heater'] }, { k: 'unit', l: 'ctl_unit', kinds: ['slider', 'display'] }, { k: 'fill', l: 'ctl_fillrate', num: true, kinds: ['syringe'] },
  { k: 'positions', l: 'ctl_positions', kinds: ['positions'], wide: true }, { k: 'off', l: 'ctl_off', kinds: ['switch'] }, { k: 'on', l: 'ctl_on', kinds: ['switch'] },
  { k: 'source', l: 'ctl_source', kinds: ['display'], src: true }, { k: 'dec', l: 'ctl_dec', num: true, kinds: ['display'] },
  { k: 'cmd', l: 'ctl_cmd', kinds: ['switch', 'button', 'positions', 'slider', 'syringe', 'heater'], wide: true }, { k: 'safe', l: 'ctl_safe', kinds: ['switch', 'positions', 'slider', 'syringe', 'heater'], wide: true }
];
function ctlSources(L) {
  const base = [['D:uv', t('ch_uv') + ' [mAU]'], ['D:press', t('ch_press') + ' [bar]'], ['D:temp', t('ch_temp') + ' [°C]'], ['D:cond', t('ch_cond') + ' [µS/cm]'], ['D:flow', t('tl_flow') + ' [ml/min]'], ['D:b', t('tl_b') + ' [%]']];
  L.parts.forEach(p => { if (p.kind === 'syringe' || p.kind === 'heater') base.push(['V:' + p.key, p.name]); else if (p.kind === 'display' && p.source && p.source.startsWith('V:')) base.push(['P:' + p.key, p.name + (p.unit ? ' [' + p.unit + ']' : '')]); });
  return base;
}
function ctlOpenPart(p, isNew) {
  const d = $('#partDlg'), L = ctlL(), w = clone(p); w.positions = (w.positions || []).map(q => q.name === q.value ? q.name : q.name + '=' + q.value).join('; ');
  const build = () => {
    const rows = CTL_FIELDS.filter(f => !f.kinds || f.kinds.includes(w.kind)).map(f => {
      const id = 'pf_' + f.k, val = w[f.k] == null ? '' : w[f.k];
      let inp;
      if (f.sel) inp = '<select id="' + id + '" data-f="kind">' + CTL_KINDS.map(k => '<option value="' + k + '"' + (k === w.kind ? ' selected' : '') + '>' + t('k_' + k) + '</option>').join('') + '</select>';
      else if (f.rolesel) { const opts = w.kind === 'positions' ? ['', 'inj'] : ['', 'flow', 'pumpA', 'pumpB'];
        inp = '<select id="' + id + '" data-f="role">' + opts.map(k => '<option value="' + k + '"' + (k === (w.role || '') ? ' selected' : '') + '>' + t('role_' + (k || 'none')) + '</option>').join('') + '</select>'; }
      else if (f.fwsel) inp = '<select id="' + id + '" data-f="fw">' + CTL_FW_KINDS.map(k => '<option value="' + k + '"' + (k === (w.fw || CTL_FW[w.kind]) ? ' selected' : '') + '>' + k + '</option>').join('') + '</select>';
      else if (f.src) { const own = 'V:' + w.key, list = ctlSources(L).filter(s => !s[0].startsWith('P:')); if (!list.some(s => s[0] === own)) list.push([own, own]);
        inp = '<select id="' + id + '" data-f="source">' + list.map(s => '<option value="' + esc(s[0]) + '"' + (s[0] === val ? ' selected' : '') + '>' + esc(s[1]) + '</option>').join('') + '</select>'; }
      else inp = '<input id="' + id + '" data-f="' + f.k + '" type="' + (f.num ? 'number' : 'text') + '"' + (f.num ? ' step="any"' : '') + ' value="' + esc(val) + '">';
      return '<label' + (f.wide ? ' class="wide"' : '') + '><span>' + t(f.l) + '</span>' + inp + '</label>';
    }).join('');
    d.innerHTML = '<h3>' + t('ctl_part') + '</h3><div class="form">' + rows + '</div><div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-x="cancel">' + t('cancel') + '</button><button type="button" class="btn primary" data-x="ok">' + t('ok') + '</button></div>';
  };
  const read = () => d.querySelectorAll('[data-f]').forEach(e => { w[e.dataset.f] = e.type === 'number' ? (e.value === '' ? null : +e.value) : e.value; });
  d.onchange = e => { if (e.target.dataset.f === 'kind') { read(); if (w.kind === 'slider' || w.kind === 'heater') { if (w.min == null) w.min = 0; if (w.max == null) w.max = 100; } if (w.kind === 'syringe' && w.max == null) w.max = 60; if (w.kind === 'display' && !w.source) w.source = 'V:' + w.key; w.fw = CTL_FW[w.kind]; build(); } };
  d.onclick = e => {
    const b = e.target.closest('button[data-x]'); if (!b) return;
    if (b.dataset.x === 'ok') {
      read(); const oldKey = p.key;
      w.key = uniqueKey(w.key, L.parts.filter(q => q.id !== p.id)); w.name = w.name || w.key; w.positions = parsePositions(w.positions);
      if (w.kind === 'positions' && !w.positions.length) w.positions = [{ name: '1', value: '1' }, { name: '2', value: '2' }];
      if ((w.kind === 'slider' || w.kind === 'heater') && !(w.max > w.min)) w.max = (+w.min || 0) + 1;
      if (w.role) L.parts.forEach(q => { if (q.id !== p.id && q.role === w.role) q.role = ''; });
      Object.keys(p).forEach(k => delete p[k]); Object.assign(p, w);
      if (oldKey !== p.key) { (L.procs || []).forEach(pr => pr.steps.forEach(st => { if (st.key === oldKey) st.key = p.key; if (st.src === 'V:' + oldKey) st.src = 'V:' + p.key; if (st.src === 'P:' + oldKey) st.src = 'P:' + p.key; })); delete CTL.values[oldKey]; }
      ctlSave(); ctlConfigure(true); logAudit(isNew ? 'component added' : 'component changed', ctlL().name + ' · ' + p.name);
    } else if (isNew) { L.parts = L.parts.filter(q => q.id !== p.id); ctlSave(); }
    d.close(); renderCtl();
  };
  d.oncancel = () => { if (isNew) { L.parts = L.parts.filter(q => q.id !== p.id); ctlSave(); renderCtl(); } };
  build(); d.showModal();
}

/* ---------- Ablauf ---------- */
function ctlProc() { const L = ctlL(); if (!L.procs) L.procs = []; const pr = L.procs.find(q => q.id === CTL.procId) || L.procs[0] || null; CTL.procId = pr ? pr.id : null; return pr; }
function ctlStepHtml(st, i, L, run) {
  const dis = run ? ' disabled' : '', cls = run ? (i < run.idx ? 'past' : i === run.idx ? 'cur' : '') : '';
  const sel = (k, opts, cur) => '<select data-s="' + i + '" data-k="' + k + '"' + dis + '>' + opts.map(o => '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
  const num = (k, cur, lbl) => '<input type="number" step="any" data-s="' + i + '" data-k="' + k + '" value="' + (cur == null ? '' : cur) + '" aria-label="' + esc(lbl) + '"' + dis + '>';
  let h = '<li class="' + cls + '"><span class="ix">' + (i + 1) + '</span>' + sel('type', [['set', t('pr_set')], ['wait', t('pr_wait')], ['until', t('pr_until')]], st.type);
  if (st.type === 'set') {
    const parts = L.parts.filter(p => p.kind !== 'display'), p = parts.find(q => q.key === st.key);
    h += sel('key', parts.map(q => [q.key, q.name]), st.key);
    if (p && p.kind === 'switch') h += sel('value', [['0', p.off || t('ctl_off')], ['1', p.on || t('ctl_on')]], st.value);
    else if (p && p.kind === 'positions') h += sel('value', (p.positions || []).map(q => [q.value, q.name]), st.value);
    else if (p && p.kind !== 'button') h += num('value', st.value, t('pr_set')) + '<span class="lbl">' + esc(p.unit || '') + '</span>';
  } else if (st.type === 'wait') h += num('sec', st.sec, t('pr_wait')) + '<span class="lbl">s</span>';
  else h += sel('src', ctlSources(L), st.src) + sel('op', [['>', '>'], ['<', '<']], st.op) + num('value', st.value, t('pr_until')) + '<span class="lbl">' + t('pr_timeout') + '</span>' + num('timeout', st.timeout, t('pr_timeout'));
  return h + '<button type="button" class="btn small" data-srm="' + i + '" aria-label="' + t('m_del') + '"' + dis + '>✕</button></li>';
}
function renderProc() {
  const L = ctlL(), pr = ctlProc(), run = CTL.run, dis = run ? ' disabled' : '';
  let h = '<h2>' + t('pr_title') + '</h2><div class="row wrap" style="margin-top:0"><select id="prSel" aria-label="' + t('pr_title') + '"' + dis + ' style="flex:1;min-width:120px">' + L.procs.map(q => '<option value="' + q.id + '"' + (pr && q.id === pr.id ? ' selected' : '') + '>' + esc(q.name) + '</option>').join('') + '</select>' +
    '<button type="button" class="btn small" id="prNew"' + dis + '>' + t('pr_new') + '</button></div>';
  if (pr) h += '<div class="row"><input id="prName" type="text" value="' + esc(pr.name) + '" aria-label="' + t('pr_name') + '"' + dis + '><button type="button" class="btn small danger" id="prDel"' + dis + '>' + t('m_del') + '</button></div>' +
    '<div class="row wrap"><button type="button" class="btn primary" id="prStart"' + (run || !pr.steps.length ? ' disabled' : '') + '>' + t('pr_start') + '</button><button type="button" class="btn" id="prPause"' + (run ? '' : ' disabled') + '>' + t(run && run.paused ? 'pr_resume' : 'pr_pause') + '</button>' +
    '<button type="button" class="btn danger" id="prStop"' + (run ? '' : ' disabled') + '>' + t('pr_stop') + '</button></div><p class="hint" id="prStatus">' + t('pr_idle') + '</p>' +
    (pr.steps.length ? '<ol class="steps">' + pr.steps.map((st, i) => ctlStepHtml(st, i, L, run)).join('') + '</ol>' : '<p class="hint">' + t('pr_none') + '</p>') +
    '<button type="button" class="btn small" id="prAdd"' + dis + '>' + t('pr_addstep') + '</button>';
  $('#procCard').innerHTML = h;
}
function ctlProcEnd(reason) {
  const pr = ctlProc(); CTL.run = null;
  if (reason === 'done') toast(t('pr_done')); else toast(t(reason === 'timeout' ? 'pr_timeout_msg' : 'pr_stopped'), true);
  ctlLogLine('— ' + t(reason === 'done' ? 'pr_done' : reason === 'timeout' ? 'pr_timeout_msg' : 'pr_stopped'));
  logAudit('procedure ' + reason, pr ? pr.name : ''); if (S.tab === 'steuerung') { renderProc(); ctlRenderNodes(); }
}
function ctlTick() {
  const r = CTL.run; if (!r || r.paused) return;
  const L = ctlL(), pr = L.procs.find(q => q.id === r.procId); if (!pr) { CTL.run = null; return; }
  if (!S.dev) { ctlProcEnd('stopped'); return; }
  const now = performance.now(); let moved = false;
  for (let guard = 0; guard < 50; guard++) {
    const st = pr.steps[r.idx]; if (!st) { ctlProcEnd('done'); return; }
    if (!r.entered) { r.entered = true; r.t0 = now; if (st.type === 'set') { const p = ctlByKey(st.key); if (p && !ctlSend(p, p.kind === 'button' ? '' : st.value)) { ctlProcEnd('stopped'); return; } } }
    const state = stepState(st, (now - r.t0) / 1000, st.type === 'until' ? readSource(st.src, S.last, CTL.meas, L.parts) : null);
    if (state === 'done') { r.idx++; r.entered = false; moved = true; continue; }
    if (state === 'timeout') { ctlProcEnd('timeout'); return; }
    break;
  }
  if (S.tab !== 'steuerung') return;
  if (moved) { renderProc(); ctlRenderNodes(); }
  const e = $('#prStatus'); if (e) e.textContent = t('pr_step') + ' ' + (r.idx + 1) + ' / ' + pr.steps.length + ' · ' + mmss((now - r.t0) / 1000) + ' · ' + mmss((now - r.start) / 1000);
}

/* ---------- Ereignisse ---------- */
function ctlBind() {
  const inner = $('#flowInner');
  inner.addEventListener('click', e => {
    const hit = e.target.closest('path.hit');
    if (hit && CTL.edit) { ctlL().links.splice(+hit.dataset.i, 1); ctlSave(); ctlDrawLinks(); return; }
    const node = e.target.closest('.node'); if (!node) { if (CTL.linkFrom) { CTL.linkFrom = null; renderCtl(); } return; }
    const p = ctlById(node.dataset.id), b = e.target.closest('button[data-act]'), L = ctlL(); if (!p) return;
    if (CTL.linkFrom && !(b && b.dataset.act === 'link')) {
      if (CTL.linkFrom !== p.id && !L.links.some(l => l.from === CTL.linkFrom && l.to === p.id)) { L.links.push({ from: CTL.linkFrom, to: p.id }); ctlSave(); }
      CTL.linkFrom = null; renderCtl(); return;
    }
    if (!b) return;
    const act = b.dataset.act, valIn = node.querySelector('[data-role="value"]');
    if (act === 'link') { CTL.linkFrom = CTL.linkFrom === p.id ? null : p.id; renderCtl(); }
    else if (act === 'edit') ctlOpenPart(p, false);
    else if (act === 'del') confirmDlg(t('ctl_del_part')).then(ok => { if (!ok) return; L.parts = L.parts.filter(q => q.id !== p.id); L.links = L.links.filter(l => l.from !== p.id && l.to !== p.id); ctlSave(); ctlConfigure(true); logAudit('component deleted', L.name + ' · ' + p.name); renderCtl(); });
    else if (act === 'set') { if (ctlSend(p, b.dataset.v)) ctlRenderNodes(); }
    else if (act === 'deliver') { p.value = Math.abs(+valIn.value || 0); ctlSave(); if (ctlSend(p, p.value)) ctlRenderNodes(); }
    else if (act === 'fill') { if (ctlSend(p, -(+p.fill || 5))) ctlRenderNodes(); }
    else if (act === 'heat') { p.value = +valIn.value || p.min; ctlSave(); if (ctlSend(p, p.value)) ctlRenderNodes(); }
  });
  inner.addEventListener('input', e => { if (e.target.dataset.act === 'range') { const n = e.target.closest('.node'), p = ctlById(n.dataset.id); n.querySelector('[data-val]').textContent = fmt(+e.target.value, decOf(p.step)); } });
  inner.addEventListener('change', e => {
    const n = e.target.closest('.node'); if (!n) return; const p = ctlById(n.dataset.id); if (!p) return;
    if (e.target.dataset.act === 'range') ctlSend(p, e.target.value);
    else if (e.target.dataset.role === 'value') { p.value = +e.target.value; ctlSave(); }
  });
  inner.addEventListener('pointerdown', e => {
    if (!CTL.edit || CTL.linkFrom) return; const h = e.target.closest('.nh'); if (!h) return;
    const node = h.parentElement, p = ctlById(node.dataset.id); if (!p) return;
    e.preventDefault(); try { h.setPointerCapture(e.pointerId); } catch (err) {}
    const f = $('#flow'), sx = e.clientX + f.scrollLeft, sy = e.clientY + f.scrollTop, ox = p.x, oy = p.y;
    const mv = ev => { p.x = Math.max(0, Math.round((ox + ev.clientX + f.scrollLeft - sx) / 10) * 10); p.y = Math.max(0, Math.round((oy + ev.clientY + f.scrollTop - sy) / 10) * 10); node.style.left = p.x + 'px'; node.style.top = p.y + 'px'; ctlDrawLinks(); };
    const up = () => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); ctlSave(); ctlSize(); };
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });
  $('#ctlSel').onchange = e => { if (CTL.run) ctlProcEnd('stopped'); CTL.cur = e.target.value; CTL.values = {}; CTL.hist = {}; CTL.linkFrom = null; CTL.procId = null; ctlSave(); ctlConfigure(true); renderCtl(); };
  $('#ctlEdit').onclick = () => { CTL.edit = !CTL.edit; CTL.linkFrom = null; if (!CTL.edit) ctlConfigure(); renderCtl(); };
  $('#ctlAdd').onclick = ctlOpenLib; $('#ctlStopAll').onclick = () => ctlStopAll();
  $('#ctlNew').onclick = () => { const l = { id: uid(), name: t('ctl_newlayout') + ' ' + (CTL.layouts.length + 1), parts: [], links: [], procs: [] }; CTL.layouts.push(l); CTL.cur = l.id; CTL.edit = true; CTL.values = {}; CTL.procId = null; ctlSave(); renderCtl(); };
  $('#ctlName').onchange = e => { ctlL().name = e.target.value.trim() || ctlL().name; ctlSave(); renderCtl(); };
  $('#ctlDel').onclick = async () => { if (CTL.layouts.length < 2 || !(await confirmDlg(t('ctl_del_layout')))) return; const L = ctlL(); CTL.layouts = CTL.layouts.filter(l => l.id !== L.id); CTL.cur = CTL.layouts[0].id; CTL.procId = null; ctlSave(); logAudit('setup deleted', L.name); renderCtl(); };
  $('#ctlExport').onclick = async () => { const L = ctlL(); if (!(await saveFile(fileSafe(L.name) + '_Aufbau.json', JSON.stringify(L)))) toast(t('t_declined')); };
  $('#ctlImport').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const l = JSON.parse(await f.text()); if (!l || !Array.isArray(l.parts)) throw new Error('format'); l.id = uid(); l.name = l.name || f.name; l.links = l.links || []; l.procs = l.procs || [];
      CTL.layouts.push(l); CTL.cur = l.id; CTL.procId = null; ctlSave(); ctlConfigure(true); logAudit('setup imported', l.name); renderCtl(); } catch (err) { toast(t('t_badfile'), true); }
  };
  const pc = $('#procCard');
  pc.addEventListener('change', e => {
    const el = e.target, L = ctlL(), pr = ctlProc();
    if (el.id === 'prSel') { CTL.procId = el.value; renderProc(); return; }
    if (!pr) return;
    if (el.id === 'prName') { pr.name = el.value.trim() || pr.name; ctlSave(); renderProc(); return; }
    const st = pr.steps[+el.dataset.s]; if (!st || !el.dataset.k) return; const k = el.dataset.k;
    if (k === 'type') { const first = L.parts.find(p => p.kind !== 'display'); Object.keys(st).forEach(q => delete st[q]);
      Object.assign(st, el.value === 'set' ? { type: 'set', key: first ? first.key : '', value: '' } : el.value === 'wait' ? { type: 'wait', sec: 10 } : { type: 'until', src: 'D:press', op: '>', value: 1, timeout: 60 }); }
    else if (k === 'key') { st.key = el.value; const p = ctlByKey(st.key); st.value = !p ? '' : p.kind === 'switch' ? '1' : p.kind === 'positions' ? ((p.positions[0] || {}).value || '') : p.kind === 'button' ? '' : '0'; }
    else st[k] = el.type === 'number' ? (el.value === '' ? 0 : +el.value) : el.value;
    if (st.type === 'set' && st.value != null) st.value = String(st.value);
    ctlSave(); renderProc();
  });
  pc.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return; const L = ctlL(), pr = ctlProc();
    if (b.id === 'prNew') { const n = { id: uid(), name: t('pr_new') + ' ' + (L.procs.length + 1), steps: [] }; L.procs.push(n); CTL.procId = n.id; ctlSave(); renderProc(); }
    else if (b.id === 'prDel' && pr) { if (await confirmDlg(t('pr_del_q'))) { L.procs = L.procs.filter(q => q.id !== pr.id); CTL.procId = null; ctlSave(); renderProc(); } }
    else if (b.id === 'prAdd' && pr) { pr.steps.push({ type: 'wait', sec: 10 }); ctlSave(); renderProc(); }
    else if (b.dataset.srm != null && pr) { pr.steps.splice(+b.dataset.srm, 1); ctlSave(); renderProc(); }
    else if (b.id === 'prStart' && pr) {
      if (!S.dev) { toast(t('t_noconn'), true); return; } if (S.phase !== 'idle') { toast(t('ctl_runlock'), true); return; }
      const now = performance.now(); CTL.run = { procId: pr.id, idx: 0, entered: false, t0: now, start: now, paused: false };
      ctlLogLine('— ' + pr.name); logAudit('procedure started', L.name + ' · ' + pr.name); renderProc();
    }
    else if (b.id === 'prPause' && CTL.run) { const r = CTL.run, now = performance.now(); if (r.paused) { r.t0 += now - r.pauseAt; r.start += now - r.pauseAt; r.paused = false; } else { r.paused = true; r.pauseAt = now; } renderProc(); if (r.paused) $('#prStatus').textContent = t('pr_paused'); }
    else if (b.id === 'prStop' && CTL.run) ctlProcEnd('stopped');
  });
}
async function ctlInit() {
  const sv = await Store.get('kv', 'control');
  if (sv && Array.isArray(sv.layouts) && sv.layouts.length) { CTL.layouts = sv.layouts; CTL.cur = sv.cur; }
  else { CTL.layouts = ctlDefaults(); CTL.cur = CTL.layouts[0].id; ctlSave(); }
  CTL.layouts.forEach(l => { l.links = l.links || []; l.procs = l.procs || []; });
  ctlBind(); setInterval(ctlTick, 200);
}
