'use strict';
/*
 * Steuerung: Bauteil-Bibliothek und Rechenregeln (ohne Oberfläche, damit sie automatisch testbar sind).
 *
 * Allgemeine Befehle an das Gerät:
 *   CFG <kurzname> <ART> <pins> [max]   Bauteil anmelden (ART: SWITCH, BUTTON, POS, VALUE, SYRINGE, HEATER, SENSOR)
 *   SET <kurzname> <wert>               Bauteil stellen
 * Gerät → App:
 *   V,<kurzname>,<wert>                 Messwert oder Zustand eines Bauteils (z. B. Füllstand, Ist-Temperatur)
 * Bauteile mit eigenem Befehl (z. B. "FLOW {v}") nutzen die Befehle der Methode und brauchen kein CFG.
 */
const CTL_FW = { switch: 'SWITCH', button: 'BUTTON', positions: 'POS', slider: 'VALUE', syringe: 'SYRINGE', heater: 'HEATER', display: 'SENSOR' };
const CTL_KINDS = Object.keys(CTL_FW);

const CTL_LIB = [
  { lib: 'syringe', group: 'pumps', de: 'Spritzenpumpe (Schrittmotor mit Spindel)', en: 'Syringe pump (stepper with lead screw)', kind: 'syringe', key: 'pumpe', min: 0, max: 60, step: 0.05, unit: 'ml/min', fill: 5, value: 0.5, safe: '0', pin: '2/3/4' },
  { lib: 'peri_dc', group: 'pumps', de: 'Schlauchpumpe mit Gleichstrommotor', en: 'Peristaltic pump, DC motor', kind: 'slider', key: 'schlauch', min: -100, max: 100, step: 5, unit: '%', safe: '0', stop: true, pin: '5/6' },
  { lib: 'peri_step', group: 'pumps', de: 'Schlauchpumpe mit Schrittmotor', en: 'Peristaltic pump, stepper', kind: 'slider', key: 'schlauch', min: -10, max: 10, step: 0.1, unit: 'ml/min', safe: '0', stop: true, pin: '5/6/7' },
  { lib: 'hahn3', group: 'valves', de: '3-Wege-Hahn mit Servo', en: '3-way stopcock with servo', kind: 'positions', key: 'hahn', positions: [{ name: 'Pumpen', value: '20' }, { name: 'Füllen', value: '110' }], pin: '9' },
  { lib: 'multi', group: 'valves', de: 'Mehrwegeventil (Drehventil, 6 Positionen)', en: 'Multiport valve (rotary, 6 positions)', kind: 'positions', key: 'ventil', positions: [1, 2, 3, 4, 5, 6].map(n => ({ name: String(n), value: String(n) })), pin: '8/9/10' },
  { lib: 'magnet', group: 'valves', de: 'Magnetventil', en: 'Solenoid valve', kind: 'switch', key: 'mv', off: 'Zu', on: 'Auf', safe: '0', pin: '7' },
  { lib: 'servo', group: 'valves', de: 'Servo, frei einstellbar', en: 'Servo, free angle', kind: 'slider', key: 'servo', min: 0, max: 180, step: 1, unit: '°', safe: '', pin: '11' },
  { lib: 'heater', group: 'heat', de: 'Heizung mit Temperaturfühler', en: 'Heater with temperature sensor', kind: 'heater', key: 'heizung', min: 20, max: 60, step: 1, unit: '°C', value: 40, safe: '0', pin: '6/2' },
  { lib: 'relay', group: 'heat', de: 'Relais oder MOSFET-Ausgang', en: 'Relay or MOSFET output', kind: 'switch', key: 'relais', safe: '0', pin: '4' },
  { lib: 'pwm', group: 'heat', de: 'Leistungsausgang (PWM)', en: 'Power output (PWM)', kind: 'slider', key: 'pwm', min: 0, max: 100, step: 1, unit: '%', safe: '0', stop: true, pin: '3' },
  { lib: 'uvled', group: 'det', de: 'UV-LED', en: 'UV LED', kind: 'switch', key: 'led', cmd: 'LED {v}', safe: '', pin: '3' },
  { lib: 'zero', group: 'det', de: 'Autozero', en: 'Autozero', kind: 'button', key: 'zero', cmd: 'ZERO' },
  { lib: 'uv', group: 'sens', de: 'UV-Signal (Extinktion)', en: 'UV signal (absorbance)', kind: 'display', key: 'uv', unit: 'mAU', source: 'D:uv', dec: 2 },
  { lib: 'press', group: 'sens', de: 'Drucksensor', en: 'Pressure sensor', kind: 'display', key: 'druck', unit: 'bar', source: 'D:press', dec: 2, pin: 'A2' },
  { lib: 'ds18', group: 'sens', de: 'Temperaturfühler DS18B20', en: 'Temperature sensor DS18B20', kind: 'display', key: 'temp', unit: '°C', source: 'D:temp', dec: 1, pin: '2' },
  { lib: 'cond', group: 'sens', de: 'Leitfähigkeit', en: 'Conductivity', kind: 'display', key: 'leitf', unit: 'µS/cm', source: 'D:cond', dec: 1 },
  { lib: 'ads', group: 'sens', de: 'ADS1115-Kanal (z. B. Photodiode)', en: 'ADS1115 channel (e.g. photodiode)', kind: 'display', key: 'adc', unit: 'V', source: 'V:adc', dec: 4, pin: 'A0' },
  { lib: 'limit', group: 'sens', de: 'Endschalter oder Lecksensor', en: 'Limit switch or leak sensor', kind: 'display', key: 'schalter', unit: '', source: 'V:schalter', dec: 0, pin: '12' },
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
/* Anmeldung aller Bauteile ohne eigenen Befehl beim Gerät */
function configCommands(parts) {
  return parts.filter(p => !p.cmd && !(p.kind === 'display' && String(p.source || '').startsWith('D:'))).map(p => 'CFG ' + p.key + ' ' + CTL_FW[p.kind] + ' ' + (String(p.pin || '').replace(/\s+/g, '') || '-') + (p.kind === 'syringe' ? ' ' + p.max : ''));
}
/* Was bei „Alles stopp“ gesendet wird */
function safeCommands(parts) {
  return parts.filter(p => p.kind !== 'display' && p.kind !== 'button' && p.safe != null && String(p.safe).trim() !== '')
    .map(p => ({ key: p.key, value: String(p.safe).trim(), cmd: partCommand(p, String(p.safe).trim()) }));
}
/* Messwert lesen: "D:press" = Feld der Datenzeile, "V:pumpe" = Wert eines Bauteils */
function readSource(src, last, meas) {
  if (!src) return null;
  const i = src.indexOf(':'), a = src.slice(0, i), b = src.slice(i + 1);
  const v = a === 'D' ? (last ? last[b] : null) : (meas ? meas[b] : null);
  return v == null || !isFinite(v) ? null : +v;
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

if (typeof module !== 'undefined') module.exports = { CTL_LIB, CTL_KINDS, CTL_FW, partCommand, configCommands, safeCommands, readSource, stepState, uniqueKey, parsePositions, linkPath };
