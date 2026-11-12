'use strict';
/*
 * Zeichenfläche für Chromatogramme: mehrere Felder untereinander, gemeinsame Zeitachse,
 * Zoom (Mausrad, zwei Finger), Verschieben (Ziehen), Fadenkreuz mit Messwerten.
 * spec = { x0, x1, xLabel, panes: [{ h, left:{label,min?,max?,minSpan?}, right:{label,min,max,color}?, series:[{x,y,color,axis,dash,width}], peaks:[...] }] }
 */
function niceTicks(a, b, target) {
  const span = b - a; if (!(span > 0)) return [a];
  const raw = span / Math.max(1, target), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, out = [];
  for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  out.step = step; return out;
}
function tickFmt(v, step) { const d = Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9))); return fmt(v, d); }
function lowerBound(x, v) { let lo = 0, hi = x.length; while (lo < hi) { const m = (lo + hi) >> 1; if (x[m] < v) lo = m + 1; else hi = m; } return lo; }

class Plot {
  constructor(canvas, onView) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.onView = onView || (() => {});
    this.spec = null; this.cur = null; this.ptrs = new Map(); this.drag = null; this.pinch = null; this.rects = []; this.scales = []; this.box = null;
    this.bind();
    if (window.ResizeObserver) new ResizeObserver(() => this.draw()).observe(canvas.parentElement);
  }
  set(spec) { this.spec = spec; this.draw(); }
  css(n) { if (this.theme && this.theme[n]) return this.theme[n]; return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888'; }
  xAt(px) { const r = this.rects[0], s = this.spec; return s.x0 + (px - r.x) / r.w * (s.x1 - s.x0); }
  bind() {
    const cv = this.cv;
    cv.addEventListener('wheel', e => {
      if (!this.spec || !this.rects.length) return; e.preventDefault();
      const x = this.xAt(e.offsetX), f = e.deltaY > 0 ? 1.25 : 0.8, s = this.spec;
      this.onView(x - (x - s.x0) * f, x + (s.x1 - x) * f);
    }, { passive: false });
    cv.addEventListener('pointerdown', e => {
      if (!this.spec || !this.rects.length) return;
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      this.ptrs.set(e.pointerId, e.offsetX);
      const s = this.spec;
      if (this.ptrs.size === 1) {
        let pi = this.rects.findIndex(r => e.offsetY >= r.y && e.offsetY <= r.y + r.h); if (pi < 0) pi = 0;
        /* Ziehen = Zoomfenster; mit Umschalttaste oder mittlerer Maustaste = verschieben */
        this.drag = { mode: (e.shiftKey || e.button === 1) ? 'pan' : (this.rangeMode && pi === 0) ? 'range' : 'box', touch: e.pointerType !== 'mouse', pi, px: e.offsetX, py: e.offsetY, x0: s.x0, x1: s.x1, moved: false };
      } else if (this.ptrs.size === 2) { const v = [...this.ptrs.values()]; this.pinch = { d: Math.max(10, Math.abs(v[0] - v[1])), x0: s.x0, x1: s.x1, cx: this.xAt((v[0] + v[1]) / 2) }; this.drag = null; this.box = null; }
    });
    cv.addEventListener('pointermove', e => {
      if (!this.spec || !this.rects.length) return;
      if (this.ptrs.has(e.pointerId)) {
        this.ptrs.set(e.pointerId, e.offsetX);
        if (this.pinch && this.ptrs.size === 2) {
          const v = [...this.ptrs.values()], f = this.pinch.d / Math.max(10, Math.abs(v[0] - v[1])), p = this.pinch;
          this.onView(p.cx - (p.cx - p.x0) * f, p.cx + (p.x1 - p.cx) * f);
        } else if (this.drag) {
          const g = this.drag, dpx = e.offsetX - g.px;
          if (Math.abs(dpx) > 3 || Math.abs(e.offsetY - g.py) > 3) g.moved = true;
          if (!g.moved) return;
          if (g.mode === 'pan') { const dx = dpx / this.rects[0].w * (g.x1 - g.x0); this.onView(g.x0 - dx, g.x1 - dx); }
          else {
            const r = this.rects[g.pi], cl = (v, a, b) => Math.max(a, Math.min(b, v));
            const xa = cl(g.px, r.x, r.x + r.w), xb = cl(e.offsetX, r.x, r.x + r.w);
            const full = g.touch || g.mode === 'range', ya = full ? r.y : cl(g.py, r.y, r.y + r.h), yb = full ? r.y + r.h : cl(e.offsetY, r.y, r.y + r.h);
            this.box = { x: Math.min(xa, xb), y: Math.min(ya, yb), w: Math.abs(xb - xa), h: Math.abs(yb - ya), pi: g.pi, full, range: g.mode === 'range' };
            this.cur = null; this.draw();
          }
        }
      } else { this.cur = this.xAt(e.offsetX); this.draw(); }
    });
    const up = e => {
      this.ptrs.delete(e.pointerId); if (this.ptrs.size < 2) this.pinch = null;
      if (!this.ptrs.size) {
        const bx = this.box; this.box = null; this.drag = null;
        if (bx && bx.range) { if (e.type === 'pointerup' && bx.w > 3 && this.onRange) this.onRange(this.xAt(bx.x), this.xAt(bx.x + bx.w)); else this.draw(); }
        else if (bx && e.type === 'pointerup' && bx.w > 8) {
          const sc = this.scales[bx.pi], r = this.rects[bx.pi];
          const ySel = (!bx.full && bx.h > 8 && sc) ? { pane: bx.pi, lo: sc.lo + (r.y + r.h - bx.y - bx.h) / r.h * (sc.hi - sc.lo), hi: sc.lo + (r.y + r.h - bx.y) / r.h * (sc.hi - sc.lo) } : undefined;
          this.onView(this.xAt(bx.x), this.xAt(bx.x + bx.w), ySel);
        } else if (bx) this.draw();
      }
    };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', () => { if (!this.ptrs.size) { this.cur = null; this.draw(); } });
    cv.addEventListener('dblclick', () => this.onView(null));
  }
  draw() {
    const sp = this.spec, cv = this.cv, ctx = this.ctx; if (!sp) return;
    const box = cv.parentElement.getBoundingClientRect(), W = Math.max(220, box.width), H = Math.max(160, box.height), dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const C = { ink: this.css('--ink'), muted: this.css('--muted'), line: this.css('--line'), panel: this.css('--panel') };
    const font = '11px ' + (this.css('--f-mono') || 'monospace');
    const mL = 58, mR = sp.panes.some(p => p.right) ? 44 : 12, mT = 16, mB = 34, gap = 22;
    const total = H - mT - mB - gap * (sp.panes.length - 1), hs = sp.panes.reduce((s, p) => s + p.h, 0);
    let y = mT; this.rects = []; this.scales = [];
    const xt = niceTicks(sp.x0, sp.x1, Math.max(3, Math.floor((W - mL - mR) / 80)));
    sp.panes.forEach((pane, pi) => {
      const r = { x: mL, y, w: W - mL - mR, h: total * pane.h / hs }; this.rects.push(r); y += r.h + gap;
      const X = v => r.x + (v - sp.x0) / (sp.x1 - sp.x0) * r.w;
      /* Wertebereich links */
      let lo = Infinity, hi = -Infinity;
      pane.series.forEach(s => {
        if (s.axis === 'R') return;
        const i0 = Math.max(0, lowerBound(s.x, sp.x0) - 1), i1 = Math.min(s.x.length, lowerBound(s.x, sp.x1) + 1);
        for (let i = i0; i < i1; i++) { const v = s.y[i]; if (v != null && isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
      });
      const L = pane.left || {};
      if (!isFinite(lo)) { lo = 0; hi = 1; }
      const ms = L.minSpan || 1e-6;
      if (hi - lo < ms) { const c = (hi + lo) / 2; lo = c - ms / 2; hi = c + ms / 2; }
      const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
      if (L.min != null) lo = L.min; if (L.max != null) hi = L.max;
      this.scales.push({ lo, hi });
      const YL = v => r.y + r.h - (v - lo) / (hi - lo) * r.h;
      const R = pane.right, YR = R ? (v => r.y + r.h - (v - R.min) / (R.max - R.min) * r.h) : null;
      /* Gitter und Achsen */
      ctx.font = font; ctx.lineWidth = 1; ctx.strokeStyle = C.line; ctx.fillStyle = C.muted;
      const yt = niceTicks(lo, hi, Math.max(2, Math.floor(r.h / 42)));
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      yt.forEach(v => { const py = Math.round(YL(v)) + 0.5; ctx.beginPath(); ctx.moveTo(r.x, py); ctx.lineTo(r.x + r.w, py); ctx.stroke(); ctx.fillText(tickFmt(v, yt.step), r.x - 6, py); });
      xt.forEach(v => { const px = Math.round(X(v)) + 0.5; if (px < r.x - 1 || px > r.x + r.w + 1) return; ctx.beginPath(); ctx.moveTo(px, r.y); ctx.lineTo(px, r.y + r.h); ctx.stroke(); });
      if (R) { ctx.textAlign = 'left'; ctx.fillStyle = R.color || C.muted; niceTicks(R.min, R.max, 4).forEach(v => ctx.fillText(fmt(v, 0), r.x + r.w + 6, YR(v))); }
      ctx.strokeStyle = C.muted; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
      ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      if (L.label) ctx.fillText(L.label, r.x, r.y - 3);
      if (R && R.label) { ctx.textAlign = 'right'; ctx.fillStyle = R.color || C.muted; ctx.fillText(R.label, r.x + r.w + mR - 2, r.y - 3); }
      /* Kurven */
      ctx.save(); ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
      (pane.peaks || []).forEach(pk => {
        const s = pane.series[0], i0 = lowerBound(s.x, pk.start), i1 = Math.min(s.x.length - 1, lowerBound(s.x, pk.end));
        ctx.beginPath(); ctx.moveTo(X(pk.start), YL(pk.yStart));
        for (let i = i0; i <= i1; i++) ctx.lineTo(X(s.x[i]), YL(s.y[i]));
        ctx.lineTo(X(pk.end), YL(pk.yEnd)); ctx.closePath();
        ctx.globalAlpha = 0.18; ctx.fillStyle = s.color; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = C.muted; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(pk.start), YL(pk.yStart)); ctx.lineTo(X(pk.end), YL(pk.yEnd)); ctx.stroke(); ctx.setLineDash([]);
      });
      pane.series.forEach(s => {
        const Y = s.axis === 'R' ? YR : YL, n = s.x.length; if (!n || !Y) return;
        const i0 = Math.max(0, lowerBound(s.x, sp.x0) - 1), i1 = Math.min(n, lowerBound(s.x, sp.x1) + 1), cnt = i1 - i0;
        if (s.points) { ctx.fillStyle = s.color; ctx.strokeStyle = C.panel; ctx.lineWidth = 1.5; for (let i = i0; i < i1; i++) { ctx.beginPath(); ctx.arc(X(s.x[i]), Y(s.y[i]), 5, 0, 6.3); ctx.fill(); ctx.stroke(); } return; }
        const stepN = Math.max(1, Math.floor(cnt / (r.w * 2)));
        ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.4; ctx.setLineDash(s.dash || []); ctx.lineJoin = 'round'; ctx.beginPath();
        let pen = false;
        for (let i = i0; i < i1; i += stepN) {
          let mn = Infinity, mx = -Infinity, imn = i, imx = i;
          for (let j = i; j < Math.min(i1, i + stepN); j++) { const v = s.y[j]; if (v == null || !isFinite(v)) continue; if (v < mn) { mn = v; imn = j; } if (v > mx) { mx = v; imx = j; } }
          if (!isFinite(mn)) { pen = false; continue; }
          const pts = stepN === 1 ? [[s.x[i], mn]] : (imn < imx ? [[s.x[imn], mn], [s.x[imx], mx]] : [[s.x[imx], mx], [s.x[imn], mn]]);
          pts.forEach(q => { if (pen) ctx.lineTo(X(q[0]), Y(q[1])); else { ctx.moveTo(X(q[0]), Y(q[1])); pen = true; } });
        }
        ctx.stroke(); ctx.setLineDash([]);
        if (s.dot && cnt > 0) { const k = i1 - 1, v = s.y[k]; if (v != null && isFinite(v)) { ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(X(s.x[k]), Y(v), 3.2, 0, 6.3); ctx.fill(); } }
      });
      (pane.peaks || []).forEach((pk, i) => {
        const px = X(pk.rt), py = YL(pk.yApex) - 6; ctx.fillStyle = C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.font = font;
        ctx.fillText(pk.name || String(i + 1), px, Math.max(r.y + 24, py)); ctx.fillStyle = C.muted; ctx.fillText(fmt(pk.rt, 2), px, Math.max(r.y + 12, py - 12));
      });
      /* Fadenkreuz */
      if (this.cur != null && this.cur >= sp.x0 && this.cur <= sp.x1) {
        const px = X(this.cur); ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.moveTo(px, r.y); ctx.lineTo(px, r.y + r.h); ctx.stroke(); ctx.globalAlpha = 1;
        const parts = pi === 0 ? [(sp.xName || 't') + ' ' + fmt(this.cur, 2) + ' ' + (sp.xUnit || '')] : [];
        pane.series.forEach(s => { if (!s.x.length || !s.label) return; const k = Math.min(s.x.length - 1, lowerBound(s.x, this.cur)); parts.push(s.label + ' ' + fmt(s.y[k], s.dec == null ? 2 : s.dec)); });
        const txt = parts.join('   '); ctx.font = font; const tw = ctx.measureText(txt).width + 12;
        const bx = Math.min(r.x + r.w - tw - 4, Math.max(r.x + 4, px + 8));
        ctx.fillStyle = C.panel; ctx.globalAlpha = 0.92; ctx.fillRect(bx, r.y + 5, tw, 18); ctx.globalAlpha = 1;
        ctx.strokeStyle = C.line; ctx.strokeRect(bx + 0.5, r.y + 5.5, tw, 18);
        ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, bx + 6, r.y + 14.5);
      }
      ctx.restore();
      /* Zeitachse am untersten Feld */
      if (pi === sp.panes.length - 1) {
        ctx.fillStyle = C.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = font;
        xt.forEach(v => { const px = X(v); if (px >= r.x - 1 && px <= r.x + r.w + 1) ctx.fillText(tickFmt(v, xt.step), px, r.y + r.h + 6); });
        if (sp.xLabel) { ctx.textAlign = 'right'; ctx.fillText(sp.xLabel, r.x + r.w, r.y + r.h + 20); }
      }
    });
    if (this.box) { const bx = this.box, ac = this.css('--accent'); ctx.fillStyle = ac; ctx.globalAlpha = 0.14; ctx.fillRect(bx.x, bx.y, bx.w, bx.h); ctx.globalAlpha = 1; ctx.strokeStyle = ac; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.strokeRect(bx.x + 0.5, bx.y + 0.5, bx.w, bx.h); ctx.setLineDash([]); }
  }
}
