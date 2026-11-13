'use strict';
/*
 * Steuerung: Bauteil-Bibliothek und Rechenregeln (ohne Oberfläche, damit sie automatisch testbar sind).
 *
 * Allgemeine Befehle an das Gerät:
 *   CLEAR                               alle Bauteile abmelden
 *   CFG <kurzname> <ART> <pins> [max] [schritte_je_ml]   Bauteil anmelden
 *        ART: SWITCH, BUTTON, SERVO, PWM, MOTOR, STEPPER, SYRINGE, HEATER, SENSOR, LIMIT (siehe firmware/chromalog_uno)
 *   SET <kurzname> <wert>               Bauteil stellen
 * Gerät → App:
 *   V,<kurzname>,<wert>                 Messwert oder Zustand eines Bauteils (z. B. Füllstand, Ist-Temperatur)
 * Bauteile mit eigenem Befehl (z. B. "FLOW {v}") nutzen die Befehle der Methode und brauchen kein CFG.
 */
const CTL_FW = { switch: 'SWITCH', button: 'BUTTON', positions: 'SERVO', slider: 'PWM', syringe: 'SYRINGE', heater: 'HEATER', display: 'SENSOR' };   /* Vorgabe je Art */
const CTL_ROLES = ['', 'flow', 'pumpA', 'pumpB', 'inj'];   /* Rolle eines Bauteils im Methodenlauf */
const CTL_FW_KINDS = ['SWITCH', 'BUTTON', 'SERVO', 'PWM', 'MOTOR', 'STEPPER', 'SYRINGE', 'HEATER', 'SENSOR', 'LIMIT'];
const CTL_KINDS = Object.keys(CTL_FW);

const CTL_LIB = [
  { lib: 'syringe', group: 'pumps', de: 'Spritzenpumpe (Schrittmotor mit Spindel)', en: 'Syringe pump (stepper with lead screw)', kind: 'syringe', key: 'pumpe', min: 0, max: 60, step: 0.05, unit: 'ml/min', fill: 5, value: 0.5, safe: '0', pin: '4/7/8', fw: 'SYRINGE', spm: 1000 },
  { lib: 'peri_dc', group: 'pumps', de: 'Schlauchpumpe mit Gleichstrommotor', en: 'Peristaltic pump, DC motor', kind: 'slider', key: 'schlauch', min: -100, max: 100, step: 5, unit: '%', safe: '0', stop: true, pin: '5/12', fw: 'MOTOR' },
  { lib: 'peri_step', group: 'pumps', de: 'Schlauchpumpe mit Schrittmotor', en: 'Peristaltic pump, stepper', kind: 'slider', key: 'schlauch', min: -10, max: 10, step: 0.1, unit: 'ml/min', safe: '0', stop: true, pin: '4/7/8', fw: 'STEPPER', spm: 1000 },
  { lib: 'hahn3', group: 'valves', de: '3-Wege-Hahn mit Servo', en: '3-way stopcock with servo', kind: 'positions', key: 'hahn', positions: [{ name: 'Pumpen', value: '20' }, { name: 'Füllen', value: '110' }], pin: '9', fw: 'SERVO' },
  { lib: 'multi', group: 'valves', de: 'Mehrwegeventil (Servo, 6 Positionen)', en: 'Multiport valve (servo, 6 positions)', kind: 'positions', key: 'ventil', positions: [1, 2, 3, 4, 5, 6].map(n => ({ name: String(n), value: String((n - 1) * 36) })), pin: '10', fw: 'SERVO' },
  { lib: 'magnet', group: 'valves', de: 'Magnetventil', en: 'Solenoid valve', kind: 'switch', key: 'mv', off: 'Zu', on: 'Auf', safe: '0', pin: '7', fw: 'SWITCH' },
  { lib: 'servo', group: 'valves', de: 'Servo, frei einstellbar', en: 'Servo, free angle', kind: 'slider', key: 'servo', min: 0, max: 180, step: 1, unit: '°', safe: '', pin: '11', fw: 'SERVO' },
  { lib: 'heater', group: 'heat', de: 'Heizung mit Temperaturfühler', en: 'Heater with temperature sensor', kind: 'heater', key: 'heizung', min: 20, max: 60, step: 1, unit: '°C', value: 40, safe: '0', pin: '8/12', fw: 'HEATER' },
  { lib: 'relay', group: 'heat', de: 'Relais oder MOSFET-Ausgang', en: 'Relay or MOSFET output', kind: 'switch', key: 'relais', safe: '0', pin: '4', fw: 'SWITCH' },
  { lib: 'pwm', group: 'heat', de: 'Leistungsausgang (PWM)', en: 'Power output (PWM)', kind: 'slider', key: 'pwm', min: 0, max: 100, step: 1, unit: '%', safe: '0', stop: true, pin: '5', fw: 'PWM' },
  { lib: 'uvled', group: 'det', de: 'UV-LED', en: 'UV LED', kind: 'switch', key: 'led', cmd: 'LED {v}', safe: '', pin: '3' },
  { lib: 'zero', group: 'det', de: 'Autozero', en: 'Autozero', kind: 'button', key: 'zero', cmd: 'ZERO' },
  { lib: 'uv', group: 'sens', de: 'UV-Signal (Extinktion)', en: 'UV signal (absorbance)', kind: 'display', key: 'uv', unit: 'mAU', source: 'D:uv', dec: 2 },
  { lib: 'press', group: 'sens', de: 'Drucksensor (analog 0,5–4,5 V)', en: 'Pressure sensor (analog 0.5–4.5 V)', kind: 'display', key: 'druck', unit: 'bar', source: 'V:druck', dec: 2, pin: 'A2', fw: 'SENSOR', scale: 3, offset: -1.5 },
  { lib: 'ds18', group: 'sens', de: 'Temperaturfühler DS18B20', en: 'Temperature sensor DS18B20', kind: 'display', key: 'temp', unit: '°C', source: 'D:temp', dec: 1, pin: '2' },
  { lib: 'cond', group: 'sens', de: 'Leitfähigkeit', en: 'Conductivity', kind: 'display', key: 'leitf', unit: 'µS/cm', source: 'D:cond', dec: 1 },
  { lib: 'analog', group: 'sens', de: 'Analogeingang (0–5 V)', en: 'Analog input (0–5 V)', kind: 'display', key: 'analog', unit: 'V', source: 'V:analog', dec: 3, pin: 'A0', fw: 'SENSOR' },
  { lib: 'limit', group: 'sens', de: 'Endschalter oder Lecksensor', en: 'Limit switch or leak sensor', kind: 'display', key: 'schalter', unit: '', source: 'V:schalter', dec: 0, pin: '12', fw: 'LIMIT', target: '', tdir: 0 },
  { lib: 'leak', group: 'sens', de: 'Lecksensor (löst „Alles stopp“ aus)', en: 'Leak sensor (triggers “Stop all”)', kind: 'display', key: 'leck', unit: '', source: 'V:leck', dec: 0, pin: '13', fw: 'LIMIT', target: 'ALL', tdir: 0 },
  { lib: 'flow', group: 'hplc', de: 'Fluss gesamt (Befehl FLOW)', en: 'Total flow (FLOW command)', kind: 'slider', key: 'fluss', cmd: 'FLOW {v}', fb: 'flow', min: 0, max: 2, step: 0.05, unit: 'ml/min', safe: '0', stop: true },
  { lib: 'pctb', group: 'hplc', de: 'Anteil B (Befehl PCTB)', en: 'Solvent B (PCTB command)', kind: 'slider', key: 'anteilb', cmd: 'PCTB {v}', fb: 'b', min: 0, max: 100, step: 1, unit: '%', safe: '' },
  { lib: 'inj', group: 'hplc', de: 'Injektionsventil (Befehl VALVE)', en: 'Injection valve (VALVE command)', kind: 'positions', key: 'inj', cmd: 'VALVE {v}', fb: 'valve', positions: [{ name: 'Laden', value: 'LOAD' }, { name: 'Injizieren', value: 'INJECT' }], safe: 'LOAD' },
  { lib: 'custom', group: 'free', de: 'Eigenes Bauteil', en: 'Custom component', kind: 'switch', key: 'teil', safe: '' }
];

/* Befehl für ein Bauteil; {key} und {v} werden ersetzt */
function partCommand(p, v) {
  const tpl = p.cmd || (p.kind === 'button' ? 'SET {key} 1' : 'SET {key} {v}');
  return tpl.replace(/\{key\}/g, p.key).replace(/\{v\}/g, v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
}
/* Anmeldung aller Bauteile ohne eigenen Befehl beim Gerät. Endschalter kommen zuletzt, weil sie sich auf andere Bauteile beziehen. */
function configCommands(parts) {
  const fwOf = p => p.fw || CTL_FW[p.kind];
  return parts.filter(p => !p.cmd && !(p.kind === 'display' && String(p.source || '').startsWith('D:')))
    .slice().sort((x, y) => (fwOf(x) === 'LIMIT') - (fwOf(y) === 'LIMIT'))
    .map(p => { const fw = fwOf(p);
      return 'CFG ' + p.key + ' ' + fw + ' ' + (String(p.pin || '').replace(/\s+/g, '') || '-') +
        (fw === 'SYRINGE' ? ' ' + (+p.max || 60) + ' ' + (+p.spm || 0) : fw === 'STEPPER' ? ' 0 ' + (+p.spm || 0) : fw === 'LIMIT' && p.target ? ' ' + String(p.target).trim() + ' ' + (+p.tdir || 0) : ''); });
}
/*
 * Methodenbefehle (FLOW, PCTB, VALVE, STOP) auf die Bauteile des Aufbaus abbilden.
 * Rollen: 'pumpA' + 'pumpB' = Gradient aus zwei Pumpen, 'flow' = eine Pumpe, 'inj' = Injektionsventil
 * (erste Stellung = Laden, zweite = Injizieren). Ohne Rolle geht der Befehl unverändert ans Gerät.
 * st = { flow, b } merkt sich die letzten Sollwerte. Ergebnis: [{ cmd, key?, value? }]
 */
function methodCommands(parts, st, name, value) {
  const by = r => (parts || []).find(p => p.role === r), A = by('pumpA'), B = by('pumpB'), F = by('flow'), I = by('inj');
  const r3 = v => String(+(+v).toFixed(3)), set = (p, v) => ({ cmd: partCommand(p, v), key: p.key, value: v });
  if (name === 'STOP') { st.flow = 0; const out = [{ cmd: 'STOP' }]; [A, B, F].forEach(p => { if (p) out.push(set(p, '0')); }); return out; }
  if (name === 'FLOW' || name === 'PCTB') {
    if (name === 'FLOW') st.flow = +value || 0; else st.b = Math.max(0, Math.min(100, +value || 0));
    if (A && B) return [set(A, r3(st.flow * (1 - (st.b || 0) / 100))), set(B, r3(st.flow * (st.b || 0) / 100))];
    if (F) return name === 'FLOW' ? [set(F, r3(st.flow))] : [];          /* eine Pumpe kann keinen Gradienten fahren */
    return [{ cmd: name + ' ' + value }];
  }
  if (name === 'VALVE') {
    const pos = I && (I.positions || [])[value === 'INJECT' ? 1 : 0];
    return pos ? [set(I, pos.value)] : [{ cmd: 'VALVE ' + value }];
  }
  return [{ cmd: (name + ' ' + (value == null ? '' : value)).trim() }];
}
/* Was bei „Alles stopp“ gesendet wird */
function safeCommands(parts) {
  return parts.filter(p => p.kind !== 'display' && p.kind !== 'button' && p.safe != null && String(p.safe).trim() !== '')
    .map(p => ({ key: p.key, value: String(p.safe).trim(), cmd: partCommand(p, String(p.safe).trim()) }));
}
/* Messwert lesen: "D:press" = Feld der Datenzeile, "V:pumpe" = Rohwert eines Bauteils,
   "P:druck" = Anzeige-Bauteil mit Umrechnung (Rohwert × Faktor + Versatz) */
function readSource(src, last, meas, parts) {
  if (!src) return null;
  const i = src.indexOf(':'), a = src.slice(0, i), b = src.slice(i + 1);
  if (a === 'P') { const p = (parts || []).find(q => q.key === b); return p ? partReading(p, last, meas) : null; }
  const v = a === 'D' ? (last ? last[b] : null) : (meas ? meas[b] : null);
  return v == null || !isFinite(v) ? null : +v;
}
function partReading(p, last, meas) {
  const raw = readSource(p.source && p.source.startsWith('P:') ? null : p.source, last, meas);
  if (raw == null) return null;
  const sc = p.scale == null || p.scale === '' ? 1 : +p.scale, off = +p.offset || 0;
  return raw * sc + off;
}
/* Zustand eines Ablauf-Schritts: 'done' (weiter), 'wait' (noch warten), 'timeout' (abbrechen) */
function stepState(step, elapsed, val) {
  if (step.type === 'wait') return elapsed >= (+step.sec || 0) ? 'done' : 'wait';
  if (step.type === 'until') {
    if (val != null && (step.op === '<' ? val < +step.value : val > +step.value)) return 'done';
    return (+step.timeout > 0 && elapsed >= +step.timeout) ? 'timeout' : 'wait';
  }
  return 'done';
}
function uniqueKey(base, parts) {
  const b = String(base || 'teil').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'teil';
  let k = b, i = 2;
  while (parts.some(p => p.key === k)) k = b + (i++);
  return k;
}
function parsePositions(text) {
  return String(text || '').split(/[;\n]/).map(s => s.trim()).filter(Boolean).map(s => { const i = s.indexOf('='); return i < 0 ? { name: s, value: s } : { name: s.slice(0, i).trim(), value: s.slice(i + 1).trim() }; });
}
/* Leitung zwischen zwei Kacheln (x, y, w, h): verlässt die Kachel an der Seite, die zum Ziel zeigt */
function linkPath(a, b) {
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2, dx = bcx - acx, dy = bcy - acy;
  let sx, sy, ex, ey, c1, c2;
  if (Math.abs(dx) >= Math.abs(dy)) {
    sx = dx >= 0 ? a.x + a.w : a.x; sy = acy; ex = dx >= 0 ? b.x : b.x + b.w; ey = bcy;
    const c = Math.max(30, Math.abs(ex - sx) / 2) * (dx >= 0 ? 1 : -1); c1 = [sx + c, sy]; c2 = [ex - c, ey];
  } else {
    sx = acx; sy = dy >= 0 ? a.y + a.h : a.y; ex = bcx; ey = dy >= 0 ? b.y : b.y + b.h;
    const c = Math.max(30, Math.abs(ey - sy) / 2) * (dy >= 0 ? 1 : -1); c1 = [sx, sy + c]; c2 = [ex, ey - c];
  }
  const r = v => Math.round(v);
  return 'M' + r(sx) + ' ' + r(sy) + ' C' + r(c1[0]) + ' ' + r(c1[1]) + ' ' + r(c2[0]) + ' ' + r(c2[1]) + ' ' + r(ex) + ' ' + r(ey);
}

if (typeof module !== 'undefined') module.exports = { CTL_LIB, CTL_KINDS, CTL_FW, CTL_FW_KINDS, CTL_ROLES, methodCommands, partReading, partCommand, configCommands, safeCommands, readSource, stepState, uniqueKey, parsePositions, linkPath };
