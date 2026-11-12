'use strict';
/*
 * Automatische Tests für die Rechenkerne von ChromaLog.
 * Jeder Test trägt die Nummer der Anforderung aus docs/ANFORDERUNGEN.md.
 * Start: node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze, linFit, quantify, ANALYSIS_DEFAULTS } = require('../js/analysis.js');
const { gradAt, parseLine, simulateRun } = require('../js/device.js');

/* Fester Zufall, damit jeder Testlauf dieselben Zahlen liefert */
function seed(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gaussFrom(rnd) { return () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }; }

/* Referenz-Chromatogramm: Gauß-Peaks mit bekannter Fläche [mAU·s], Lage [min] und Breite σ [s] */
function reference(peaks, opt) {
  const o = Object.assign({ minutes: 10, rate: 10, noise: 0.05, drift: 2, seed: 1 }, opt || {});
  const g = gaussFrom(seed(o.seed)), n = o.minutes * 60 * o.rate + 1, t = [], y = [];
  for (let i = 0; i < n; i++) {
    const ts = i / o.rate; let v = o.drift * i / (n - 1) + o.noise * g();
    for (const p of peaks) v += p.area / (p.sigma * Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * Math.pow((ts - p.rt * 60) / p.sigma, 2));
    t.push(ts / 60); y.push(v);
  }
  return { t, y };
}
const near = (actual, expected, relTol, what) => assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * relTol, `${what}: ${actual} statt ${expected} (Toleranz ${relTol * 100} %)`);
const REF = [{ rt: 2.0, area: 300, sigma: 3 }, { rt: 4.5, area: 120, sigma: 3.5 }, { rt: 7.0, area: 600, sigma: 4 }];

test('A-01 Gradient: lineare Interpolation zwischen den Tabellenzeilen', () => {
  const m = { gradient: [{ t: 0, b: 5 }, { t: 1, b: 5 }, { t: 9, b: 95 }, { t: 11, b: 95 }] };
  assert.equal(gradAt(m, -1), 5); assert.equal(gradAt(m, 0.5), 5); assert.equal(gradAt(m, 5), 50);
  assert.equal(gradAt(m, 9), 95); assert.equal(gradAt(m, 20), 95);
});

test('A-02 Protokoll: Datenzeilen des Geräts werden richtig gelesen', () => {
  const s = parseLine('D,12.500,0.012345,81.20,6.150,22.48,1.000,35.00,INJECT');
  assert.deepEqual(s, { kind: 'full', t: 12.5, uv: 0.012345, cond: 81.2, press: 6.15, temp: 22.48, flow: 1, b: 35, valve: 'INJECT' });
  assert.equal(parseLine('D,1.0,,80,6,22,1,5,LOAD').uv, null, 'leeres UV-Feld (LED aus) wird zu null');
});

test('A-03 Protokoll: Stufe-1-Sketch wird erkannt, Text wird verworfen', () => {
  const s = parseLine('15,2.4312,2.6001,0.9350,0.02918,23.4,0');
  assert.equal(s.kind, 'stage1'); assert.equal(s.t, 15); assert.equal(s.uv, 0.02918); assert.equal(s.temp, 23.4); assert.equal(s.press, null);
  assert.equal(parseLine('zeit_s,I_V,R_V,verhaeltnis,extinktion_AU,temp_C,uebersteuert'), null);
  assert.equal(parseLine('Bereit'), null); assert.equal(parseLine(''), null);
});

test('A-10 Peakerkennung: Anzahl und Retentionszeit (±0,01 min)', () => {
  const d = reference(REF), r = analyze(d.t, d.y);
  assert.equal(r.peaks.length, 3);
  r.peaks.forEach((p, i) => assert.ok(Math.abs(p.rt - REF[i].rt) <= 0.01, `tR ${p.rt} statt ${REF[i].rt}`));
});

test('A-11 Integration: Peakfläche auf driftender Basislinie (±2 %)', () => {
  const d = reference(REF), r = analyze(d.t, d.y);
  r.peaks.forEach((p, i) => near(p.area, REF[i].area, 0.02, 'Fläche Peak ' + (i + 1)));
  near(r.peaks.reduce((s, p) => s + p.areaPct, 0), 100, 1e-9, 'Summe Fläche %');
});

test('A-12 Kenngrößen: Höhe, Halbwertsbreite, Bodenzahl, Tailing', () => {
  const d = reference(REF), r = analyze(d.t, d.y);
  r.peaks.forEach((p, i) => {
    const q = REF[i];
    near(p.height, q.area / (q.sigma * Math.sqrt(2 * Math.PI)), 0.03, 'Höhe');
    near(p.w50, 2.3548 * q.sigma, 0.05, 'Halbwertsbreite');
    near(p.plates, Math.pow(q.rt * 60 / q.sigma, 2), 0.10, 'Bodenzahl');
    assert.ok(p.tailing > 0.9 && p.tailing < 1.1, 'Tailing eines symmetrischen Peaks: ' + p.tailing);
  });
});

test('A-13 Auflösung zwischen Nachbarpeaks (±5 %)', () => {
  const d = reference(REF), r = analyze(d.t, d.y);
  assert.equal(r.peaks[0].rs, null);
  near(r.peaks[1].rs, 1.18 * (4.5 - 2.0) * 60 / (2.3548 * 3 + 2.3548 * 3.5), 0.05, 'Rs 1/2');
});

test('A-14 Blindwert: reines Rauschen ergibt keinen Peak', () => {
  for (const sd of [1, 2, 3, 4, 5]) { const d = reference([], { seed: sd }); assert.equal(analyze(d.t, d.y).peaks.length, 0, 'Seed ' + sd); }
});

test('A-15 Schwelle: Peaks unter der Signal/Rausch-Schwelle werden nicht gemeldet', () => {
  const small = { rt: 5, area: 3, sigma: 3 };                     /* Höhe 0,4 mAU bei σ = 0,05 mAU: S/N ≈ 2,7 */
  const d = reference([small]);
  assert.equal(analyze(d.t, d.y, { sn: 5 }).peaks.length, 0);
  assert.equal(analyze(d.t, d.y, { sn: 1.5 }).peaks.length, 1);
});

test('A-16 Rohdaten bleiben bei der Auswertung unverändert', () => {
  const d = reference(REF), t0 = d.t.slice(), y0 = d.y.slice();
  analyze(d.t, d.y, ANALYSIS_DEFAULTS, [], { manual: [{ start: 1.8, end: 2.2 }], removed: [{ start: 6.5, end: 7.5 }] });
  assert.deepEqual(d.t, t0); assert.deepEqual(d.y, y0);
});

test('A-17 Manuelle Integration: eigene Grenzen und entfernte Peaks', () => {
  const d = reference(REF, { drift: 0 });
  const r = analyze(d.t, d.y, ANALYSIS_DEFAULTS, [], { manual: [{ start: 1.75, end: 2.25 }], removed: [{ start: 6.5, end: 7.5 }] });
  assert.equal(r.peaks.length, 2, 'Peak 3 entfernt, Peak 1 ersetzt');
  assert.equal(r.peaks[0].manual, true); assert.equal(r.peaks[1].manual, false);
  near(r.peaks[0].area, 300, 0.02, 'Fläche des manuellen Peaks');
  assert.equal(analyze(d.t, d.y).peaks.length, 3, 'ohne Änderungen wieder drei Peaks');
});

test('A-18 Stoffzuordnung über Retentionszeit und Fenster', () => {
  const d = reference(REF), comp = [{ name: 'A', rt: 2.05, tol: 0.1 }, { name: 'B', rt: 4.9, tol: 0.2 }, { name: 'C', rt: 7.0, tol: 0.05 }];
  assert.deepEqual(analyze(d.t, d.y, null, comp).peaks.map(p => p.name), ['A', '', 'C']);
});

test('A-19 Überlappende Peaks werden per Lot getrennt (±5 %)', () => {
  const d = reference([{ rt: 4.0, area: 300, sigma: 3 }, { rt: 4.25, area: 300, sigma: 3 }]), r = analyze(d.t, d.y);
  assert.equal(r.peaks.length, 2);
  r.peaks.forEach(p => near(p.area, 300, 0.05, 'Fläche'));
});

test('A-20 Kalibriergerade: Steigung, Achsenabschnitt, R²', () => {
  const pts = [1, 5, 10, 20].map(c => ({ conc: c, area: 60 * c + 4, sn: 30 * c }));
  const f = linFit(pts, false);
  near(f.slope, 60, 1e-9, 'Steigung'); near(f.intercept, 4, 1e-9, 'Achsenabschnitt'); near(f.r2, 1, 1e-12, 'R²');
  assert.equal(f.min, 1); assert.equal(f.max, 20); near(f.lod, 0.1, 1e-9, 'Nachweisgrenze = 3 × Konzentration / (S/N)');
  const z = linFit([{ conc: 2, area: 100 }, { conc: 4, area: 200 }], true);
  near(z.slope, 50, 1e-9, 'Steigung durch Null'); assert.equal(z.intercept, 0);
  const s = linFit([{ conc: 1, area: 10 }, { conc: 2, area: 22 }, { conc: 3, area: 28 }], false);
  near(s.r2, 0.9643, 1e-3, 'R² bei Streuung');
});

test('A-21 Kalibriergerade: zu wenige Punkte ergeben keine Gerade', () => {
  assert.equal(linFit([], false).slope, null);
  assert.equal(linFit([{ conc: 5, area: 300 }], false).slope, null);
  assert.equal(linFit([{ conc: 5, area: 300 }, { conc: 5, area: 310 }], false).slope, null, 'gleiche Konzentration zweimal');
});

test('A-22 Quantifizierung: Konzentration und Bereichsprüfung', () => {
  const c = { slope: 60, intercept: 4, min: 1, max: 20 };
  assert.deepEqual(quantify(304, c), { v: 5, out: false });
  assert.equal(quantify(34, c).out, true, 'unter dem Bereich'); assert.equal(quantify(1504, c).out, true, 'über dem Bereich');
  assert.equal(quantify(300, null), null); assert.equal(quantify(300, { slope: 0, intercept: 0 }), null);
});

test('A-30 Gesamtkette im Simulator: Standards → Kalibrierung → Probe (±5 %)', () => {
  const realRandom = Math.random; Math.random = seed(42);
  try {
    const m = { flow: 1, runtime: 14, rate: 10, gradient: [{ t: 0, b: 5 }, { t: 1, b: 5 }, { t: 9, b: 95 }, { t: 11, b: 95 }, { t: 11.2, b: 5 }, { t: 14, b: 5 }],
      compounds: [{ name: 'Koffein', rt: 3.24, tol: 0.25 }, { name: 'Benzotriazol', rt: 4.60, tol: 0.25 }, { name: 'Carbamazepin', rt: 6.30, tol: 0.25 }, { name: 'Diclofenac', rt: 7.79, tol: 0.25 }] };
    const run = conc => { const d = simulateRun(m, { type: 'standard', conc }); return analyze(d.t, d.uv.map(v => v * 1000), null, m.compounds); };
    const std = [1, 5, 20].map(c => ({ conc: c, res: run(c) })), unknown = run(3);
    assert.equal(unknown.peaks.length, 4);
    for (const c of m.compounds) {
      const fit = linFit(std.map(s => { const p = s.res.peaks.find(q => q.name === c.name); return { conc: s.conc, area: p.area, sn: p.sn }; }), false);
      assert.ok(fit.r2 > 0.999, c.name + ' R² ' + fit.r2);
      near(quantify(unknown.peaks.find(q => q.name === c.name).area, fit).v, 3, 0.05, c.name);
    }
  } finally { Math.random = realRandom; }
});
