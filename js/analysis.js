'use strict';
/*
 * Auswertung eines Chromatogramms: Basislinie, Peakerkennung, Integration, Kenngrößen.
 * Eingabe: t in Minuten, y in mAU. Rohdaten werden nie verändert.
 */
const ANALYSIS_DEFAULTS = { sn: 5, minWidth: 3, baseWin: 1.5, smooth: 1.0 };

function movAvg(a, w) {
  const n = a.length, out = new Float64Array(n), h = Math.max(0, w >> 1);
  if (!h) { for (let i = 0; i < n; i++) out[i] = a[i]; return out; }
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
  for (let i = 0; i < n; i++) { const lo = Math.max(0, i - h), hi = Math.min(n - 1, i + h); out[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1); }
  return out;
}
function rollExt(a, w, isMin) {
  const n = a.length, out = new Float64Array(n), dq = new Int32Array(n), h = Math.max(1, w >> 1);
  let head = 0, tail = 0;
  for (let i = 0; i < n + h; i++) {
    if (i < n) {
      while (tail > head && (isMin ? a[dq[tail - 1]] >= a[i] : a[dq[tail - 1]] <= a[i])) tail--;
      dq[tail++] = i;
    }
    const c = i - h;
    if (c >= 0) { while (dq[head] < c - h) head++; out[c] = a[dq[head]]; }
  }
  return out;
}
function median(arr) { const s = Array.from(arr).sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; }

function analyze(tMin, yIn, params, compounds, edits) {
  const p = Object.assign({}, ANALYSIS_DEFAULTS, params || {});
  const n = yIn.length, res = { params: p, peaks: [], noise: 0, baseline: [] };
  if (n < 30) return res;
  const y = new Float64Array(n); let lastV = 0;
  for (let i = 0; i < n; i++) { const v = yIn[i]; if (v != null && isFinite(v)) lastV = v; y[i] = lastV; }
  const ts = i => tMin[i] * 60;
  const dt = (ts(n - 1) - ts(0)) / (n - 1);
  const d = new Float64Array(n - 1);
  for (let i = 1; i < n; i++) d[i - 1] = y[i] - y[i - 1];
  const md = median(d), sigma = 1.4826 * median(d.map(v => Math.abs(v - md))) / Math.SQRT2;
  res.noise = sigma;
  const ys = movAvg(y, Math.round(p.smooth / dt) | 1);
  const w = Math.max(5, Math.round(p.baseWin * 60 / dt));
  const base = movAvg(rollExt(rollExt(ys, w, true), w, false), w);
  res.baseline = base;
  const corr = new Float64Array(n);
  for (let i = 0; i < n; i++) corr[i] = ys[i] - base[i];
  const thr = Math.max(p.sn * 3 * sigma, 1e-6), endThr = Math.max(0.6 * sigma, 1e-7);

  /* Einen Peak zwischen den Punkten s und e vermessen; Basislinie ist die Gerade von a nach b */
  const measure = (s, e, ap, a, b) => {
    const line = i => ys[a] + (ys[b] - ys[a]) * (i - a) / Math.max(1, b - a);
    let area = 0;
    for (let i = s; i < e; i++) area += ((y[i] - line(i)) + (y[i + 1] - line(i + 1))) / 2 * (ts(i + 1) - ts(i));
    const hgt = ys[ap] - line(ap);
    if (hgt <= 0 || area <= 0) return null;
    let rt = ts(ap);
    if (ap > 0 && ap < n - 1) { const y0 = ys[ap - 1], y1 = ys[ap], y2 = ys[ap + 1], den = y0 - 2 * y1 + y2; if (den < 0) rt += 0.5 * (y0 - y2) / den * dt; }
    const cross = (frac, dir) => {
      const lvl = hgt * frac; let i = ap;
      while (i !== (dir < 0 ? s : e) && (ys[i] - line(i)) > lvl) i += dir;
      const vi = ys[i] - line(i);
      if (vi > lvl || i === ap) return null;
      const j = i - dir, vj = ys[j] - line(j);
      return ts(j) + (ts(i) - ts(j)) * (vj - lvl) / Math.max(1e-12, vj - vi);
    };
    const l5 = cross(0.5, -1), r5 = cross(0.5, 1), l05 = cross(0.05, -1), r05 = cross(0.05, 1);
    const w50 = (l5 != null && r5 != null) ? r5 - l5 : null;
    return {
      rt: rt / 60, start: tMin[s], end: tMin[e], yStart: line(s), yEnd: line(e), area, height: hgt, w50,
      plates: w50 ? 5.545 * Math.pow(rt / w50, 2) : null,
      tailing: (l05 != null && r05 != null && rt - l05 > 0) ? (r05 - l05) / (2 * (rt - l05)) : null,
      sn: sigma > 0 ? hgt / (3 * sigma) : null, rs: null, areaPct: 0, name: '', manual: false
    };
  };

  /* Bereiche über der Schwelle, nach außen bis zur Basislinie erweitert */
  const regs = [];
  for (let i = 0; i < n; i++) {
    if (corr[i] <= thr) continue;
    let a = i, b = i;
    while (b + 1 < n && corr[b + 1] > thr) b++;
    while (a > 0 && corr[a - 1] > endThr) a--;
    while (b + 1 < n && corr[b + 1] > endThr) b++;
    if (regs.length && a <= regs[regs.length - 1][1]) regs[regs.length - 1][1] = Math.max(b, regs[regs.length - 1][1]);
    else regs.push([a, b]);
    i = b;
  }
  const minPts = Math.max(3, Math.round(p.minWidth / dt));
  for (const [a, b] of regs) {
    if (b - a < minPts) continue;
    /* lokale Maxima, getrennt durch Täler (Lotfällung) */
    const maxima = [];
    for (let i = a + 1; i < b; i++) {
      if (corr[i] > thr && corr[i] >= corr[i - 1] && corr[i] > corr[i + 1]) {
        let ok = true;
        for (let j = Math.max(a, i - minPts); j <= Math.min(b, i + minPts); j++) if (corr[j] > corr[i]) { ok = false; break; }
        if (ok) maxima.push(i);
      }
    }
    if (!maxima.length) continue;
    const cuts = [a], apexes = [maxima[0]];
    for (let m = 1; m < maxima.length; m++) {
      const prev = apexes[apexes.length - 1], cur = maxima[m];
      let v = prev; for (let j = prev; j <= cur; j++) if (corr[j] < corr[v]) v = j;
      if (corr[v] < 0.75 * Math.min(corr[prev], corr[cur])) { cuts.push(v); apexes.push(cur); }
      else if (corr[cur] > corr[prev]) apexes[apexes.length - 1] = cur;
    }
    cuts.push(b);
    for (let k = 0; k < apexes.length; k++) { const pk = measure(cuts[k], cuts[k + 1], apexes[k], a, b); if (pk) res.peaks.push(pk); }
  }
  /* Änderungen von Hand: entfernte Peaks und selbst gezogene Integrationsgrenzen */
  const ed = edits || {}, idx = tm => { let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (tMin[m] < tm) lo = m + 1; else hi = m; } return lo; };
  (ed.removed || []).forEach(r => { res.peaks = res.peaks.filter(q => !(q.rt >= r.start && q.rt <= r.end)); });
  (ed.manual || []).forEach(mn => {
    const s = idx(Math.min(mn.start, mn.end)), e = idx(Math.max(mn.start, mn.end));
    if (e - s < 3) return;
    res.peaks = res.peaks.filter(q => !(q.rt >= tMin[s] && q.rt <= tMin[e]));
    let ap = s, best = -Infinity;
    for (let i = s; i <= e; i++) { const v = ys[i] - (ys[s] + (ys[e] - ys[s]) * (i - s) / (e - s)); if (v > best) { best = v; ap = i; } }
    const pk = measure(s, e, ap, s, e); if (pk) { pk.manual = true; pk.mStart = mn.start; pk.mEnd = mn.end; res.peaks.push(pk); }
  });
  res.peaks.sort((x, z) => x.rt - z.rt);
  const tot = res.peaks.reduce((s, q) => s + q.area, 0);
  res.peaks.forEach((q, i) => {
    q.areaPct = tot ? 100 * q.area / tot : 0;
    const pr = res.peaks[i - 1];
    if (pr && pr.w50 && q.w50) q.rs = 1.18 * (q.rt - pr.rt) * 60 / (pr.w50 + q.w50);
    let best = null;
    (compounds || []).forEach(c => { const dd = Math.abs(q.rt - c.rt); if (dd <= c.tol && (!best || dd < best.d)) best = { d: dd, name: c.name }; });
    if (best) q.name = best.name;
  });
  return res;
}

/* Kalibriergerade Fläche = Steigung · Konzentration + Achsenabschnitt (kleinste Quadrate) */
function linFit(pts, zero) {
  const n = pts.length, none = { slope: null, intercept: null, r2: null, n, min: null, max: null, lod: null };
  if (!n || (!zero && n < 2)) return none;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  pts.forEach(q => { sx += q.conc; sy += q.area; sxx += q.conc * q.conc; sxy += q.conc * q.area; });
  let slope, icpt;
  if (zero) { if (!sxx) return none; slope = sxy / sxx; icpt = 0; }
  else { const den = n * sxx - sx * sx; if (!den) return none; slope = (n * sxy - sx * sy) / den; icpt = (sy - slope * sx) / n; }
  const my = sy / n; let sst = 0, sse = 0;
  pts.forEach(q => { sst += Math.pow(q.area - my, 2); sse += Math.pow(q.area - (slope * q.conc + icpt), 2); });
  const low = pts.reduce((a, b) => (b.conc < a.conc ? b : a));
  return { slope, intercept: icpt, r2: (n >= (zero ? 2 : 3) && sst > 0) ? 1 - sse / sst : null, n,
    min: Math.min.apply(null, pts.map(q => q.conc)), max: Math.max.apply(null, pts.map(q => q.conc)),
    lod: low.sn ? low.conc * 3 / low.sn : null };
}

if (typeof module !== 'undefined') module.exports = { analyze, ANALYSIS_DEFAULTS, linFit };
