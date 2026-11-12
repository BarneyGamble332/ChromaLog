'use strict';
/*
 * Verbindungsschicht. Jedes Gerät hat dieselbe Schnittstelle:
 *   connect(), close(), send(befehl), onLine(zeile), kind
 * Neue Anschlüsse (Bluetooth, WLAN, Android-USB) kommen als weitere Klasse dazu.
 *
 * Protokoll (Textzeilen):
 *   Gerät → App:  D,<t_s>,<uv_AU>,<leitf_uS>,<druck_bar>,<temp_C>,<fluss_ml_min>,<B_%>,<LOAD|INJECT>
 *   App → Gerät:  FLOW x | PCTB x | VALVE LOAD|INJECT | ZERO | LED 0|1 | RATE hz | STOP
 *   Stufe-1-Sketch: zeit_s,I_V,R_V,verhaeltnis,extinktion_AU,temp_C,uebersteuert  (Befehle n, d)
 */

function gradAt(method, tmin) {
  const g = method.gradient;
  if (!g || !g.length) return 0;
  if (tmin <= g[0].t) return g[0].b;
  for (let i = 1; i < g.length; i++) {
    if (tmin <= g[i].t) {
      const a = g[i - 1], b = g[i];
      return b.t === a.t ? b.b : a.b + (b.b - a.b) * (tmin - a.t) / (b.t - a.t);
    }
  }
  return g[g.length - 1].b;
}

function parseLine(line) {
  line = line.trim();
  if (!line) return null;
  const num = s => (s === '' || s == null) ? null : (isFinite(+s) ? +s : null);
  if (line.startsWith('V,')) { const f = line.split(','); return f.length >= 3 && f[1] ? { kind: 'val', key: f[1], value: num(f[2]) } : null; }
  if (line.startsWith('D,')) {
    const f = line.split(',');
    if (f.length < 9) return null;
    return { kind: 'full', t: num(f[1]), uv: num(f[2]), cond: num(f[3]), press: num(f[4]), temp: num(f[5]), flow: num(f[6]), b: num(f[7]), valve: f[8] };
  }
  const f = line.split(/[,;\t]/).map(s => s.trim());
  if (f.length >= 5 && f.slice(0, 5).every(s => s !== '' && isFinite(+s))) {
    return { kind: 'stage1', t: +f[0], uv: +f[4], cond: null, press: null, temp: num(f[5]), flow: null, b: null, valve: null };
  }
  return null;
}

/* Normalverteiltes Rauschen */
function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* Modellstoffe: log k = logkw − S·φ (Umkehrphase), amt = Peakfläche in AU·s je mg/l */
const SIM_COMPOUNDS = [
  { name: 'Koffein', logkw: 0.75, S: 3.2, resp: 0.060 },
  { name: 'Benzotriazol', logkw: 1.35, S: 3.6, resp: 0.085 },
  { name: 'Carbamazepin', logkw: 2.3, S: 4.2, resp: 0.070 },
  { name: 'Diclofenac', logkw: 3.5, S: 5.0, resp: 0.045 }
];

class SimDevice {
  constructor() {
    this.kind = 'sim'; this.onLine = () => {}; this.speed = 1; this.rate = 10;
    this.t = 0; this.flowSet = 1; this.flow = 1; this.bSet = 5; this.b = 5; this.valve = 'LOAD'; this.led = true;
    this.zero = 0; this.uvF = 0; this.wander = 0; this.bands = []; this.acc = 0; this.timer = null;
    this.sample = { type: 'standard', conc: 5 };
    this.V0 = 1.0; this.N = 2500; this.noise = 0.00025;
    this.gen = {}; this.out = []; this.vAcc = 0;      /* frei angemeldete Bauteile der Steuerung */
  }
  async connect() { this.last = performance.now(); this.timer = setInterval(() => this.tick(), 50); }
  async close() { clearInterval(this.timer); this.timer = null; }
  tick() {
    const now = performance.now();
    this.acc += Math.min(0.5, (now - this.last) / 1000) * this.speed; this.last = now;
    const step = 1 / this.rate; let n = 0;
    while (this.acc >= step && n < 600) { this.acc -= step; this.onLine(this.step(step)); n++; while (this.out.length) this.onLine(this.out.shift()); }
  }
  send(cmd) {
    const p = cmd.trim().split(/\s+/), c = (p[0] || '').toUpperCase(), v = parseFloat(p[1]);
    if (c === 'FLOW' && isFinite(v)) this.flowSet = Math.max(0, Math.min(5, v));
    else if (c === 'PCTB' && isFinite(v)) this.bSet = Math.max(0, Math.min(100, v));
    else if (c === 'RATE' && isFinite(v)) this.rate = Math.max(1, Math.min(50, v));
    else if (c === 'LED') this.led = p[1] !== '0';
    else if (c === 'ZERO') this.zero = this.uvF;
    else if (c === 'STOP') this.flowSet = 0;
    else if (c === 'CFG' && p[1]) { const old = this.gen[p[1]] || {}; this.gen[p[1]] = { kind: (p[2] || '').toUpperCase(), v: old.v || 0, max: parseFloat(p[4]) || 60, vol: old.vol != null ? old.vol : (parseFloat(p[4]) || 60) * 0.7, temp: old.temp || 22 }; }
    else if (c === 'SET' && p[1]) { const g = this.gen[p[1]] || (this.gen[p[1]] = { kind: 'VALUE', v: 0, max: 60, vol: 42, temp: 22 }); const sv = parseFloat(p[2]); g.v = isFinite(sv) ? sv : 0; }
    else if (c === 'VALVE') {
      const pos = (p[1] || '').toUpperCase();
      if (pos === 'INJECT' && this.valve !== 'INJECT') this.inject();
      if (pos === 'INJECT' || pos === 'LOAD') this.valve = pos;
    }
  }
  inject() {
    const s = this.sample || {}, bands = [{ k0: true, amt: 0.012, cond: 60, x: 0 }];
    if (s.type !== 'blank') {
      SIM_COMPOUNDS.forEach((c, i) => {
        const conc = s.type === 'standard' ? (+s.conc || 5) : [3.2, 0.8, 1.9, 0.6][i] * (0.9 + 0.2 * Math.random());
        bands.push({ logkw: c.logkw, S: c.S, amt: c.resp * conc, x: 0 });
      });
      if (s.type === 'sample') bands.push({ logkw: 1.85, S: 3.9, amt: 0.05, x: 0 });
    }
    this.bands.push(...bands);
  }
  step(dt) {
    this.t += dt;
    this.flow += (this.flowSet - this.flow) * (1 - Math.exp(-dt / 1.0));
    this.b += (this.bSet - this.b) * (1 - Math.exp(-dt / 15));
    const phi = this.b / 100, sx = 1 / Math.sqrt(this.N);
    let sig = 0, condPk = 0;
    if (this.flow > 0.005) {
      const t0 = this.V0 / this.flow * 60;
      for (const bd of this.bands) {
        const k = bd.k0 ? 0 : Math.pow(10, bd.logkw - bd.S * phi);
        const v = 1 / (t0 * (1 + k));
        bd.x += v * dt;
        const z = (1 - bd.x) / sx;
        if (Math.abs(z) < 7) {
          const c = v * Math.exp(-0.5 * z * z) / (sx * 2.5066283);
          sig += bd.amt * c; if (bd.cond) condPk += bd.cond * c;
        }
      }
      this.bands = this.bands.filter(bd => bd.x < 1 + 8 * sx);
    }
    this.wander = this.wander * (1 - dt / 400) + gauss() * 0.00002 * Math.sqrt(dt);
    const raw = sig + 0.004 * phi + this.wander;
    this.uvF += (raw - this.uvF) * (1 - Math.exp(-dt / 0.8));
    const uv = this.led ? this.uvF - this.zero + gauss() * this.noise : null;
    /* frei angemeldete Bauteile: Spritze (Füllstand), Heizung (Ist-Temperatur), Sensor (Rauschen) */
    this.vAcc += dt;
    for (const k in this.gen) {
      const g = this.gen[k];
      if (g.kind === 'SYRINGE') { g.vol = Math.max(0, Math.min(g.max, g.vol - g.v * dt / 60)); if ((g.vol <= 0 && g.v > 0) || (g.vol >= g.max && g.v < 0)) g.v = 0; }
      else if (g.kind === 'HEATER') g.temp += ((g.v > 0 ? g.v : 22) - g.temp) * (1 - Math.exp(-dt / 40));
    }
    if (this.vAcc >= 1) {
      this.vAcc = 0;
      for (const k in this.gen) {
        const g = this.gen[k];
        if (g.kind === 'SYRINGE') this.out.push('V,' + k + ',' + g.vol.toFixed(2));
        else if (g.kind === 'HEATER') this.out.push('V,' + k + ',' + (g.temp + gauss() * 0.03).toFixed(2));
        else if (g.kind === 'SENSOR') this.out.push('V,' + k + ',' + (0.5 + gauss() * 0.002).toFixed(4));
      }
      if (this.out.length > 200) this.out.length = 0;
    }
    const eta = 1 + 0.5 * phi - 1.13 * phi * phi;
    const press = this.flow * 6.2 * eta + gauss() * 0.015;
    const cond = 82 * (1 - 0.7 * phi) + condPk + gauss() * 0.05;
    const temp = 22.5 + 0.3 * Math.sin(this.t / 600) + gauss() * 0.02;
    return 'D,' + this.t.toFixed(3) + ',' + (uv == null ? '' : uv.toFixed(6)) + ',' + cond.toFixed(2) + ',' + press.toFixed(3) + ',' +
      temp.toFixed(2) + ',' + this.flow.toFixed(3) + ',' + this.b.toFixed(2) + ',' + this.valve;
  }
}

/* Kompletten Lauf ohne Wartezeit rechnen (für das Beispiel und für Tests) */
function simulateRun(method, sample) {
  const sim = new SimDevice();
  sim.rate = method.rate; sim.sample = sample; sim.flow = sim.flowSet = method.flow; sim.b = sim.bSet = gradAt(method, 0);
  const dt = 1 / method.rate;
  for (let i = 0; i < 60 * method.rate; i++) sim.step(dt);
  sim.send('ZERO'); sim.send('VALVE INJECT');
  const t0 = sim.t, d = { t: [], uv: [], cond: [], press: [], temp: [], flow: [], b: [] };
  const n = Math.round(method.runtime * 60 * method.rate);
  for (let i = 0; i <= n; i++) {
    const s = parseLine(sim.step(dt)), tm = (s.t - t0) / 60;
    sim.send('PCTB ' + gradAt(method, tm).toFixed(2));
    d.t.push(+tm.toFixed(5)); d.uv.push(s.uv); d.cond.push(s.cond); d.press.push(s.press); d.temp.push(s.temp); d.flow.push(s.flow); d.b.push(s.b);
  }
  return d;
}

class SerialDevice {
  constructor(baud) { this.kind = 'usb'; this.baud = baud || 115200; this.onLine = () => {}; this.onClose = () => {}; }
  async connect() {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: this.baud });
    this.writer = this.port.writable.getWriter();
    this.alive = true; this.readLoop();
  }
  async readLoop() {
    const dec = new TextDecoder(); let buf = '';
    try {
      while (this.alive && this.port.readable) {
        this.reader = this.port.readable.getReader();
        try {
          for (;;) {
            const { value, done } = await this.reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); this.onLine(l); }
          }
        } finally { this.reader.releaseLock(); }
        break;
      }
    } catch (e) { /* Kabel gezogen */ }
    if (this.alive) { this.alive = false; this.onClose(); }
  }
  send(cmd) { if (this.writer) this.writer.write(new TextEncoder().encode(cmd + '\n')).catch(() => {}); }
  async close() {
    this.alive = false;
    try { if (this.reader) await this.reader.cancel(); } catch (e) {}
    try { if (this.writer) this.writer.releaseLock(); } catch (e) {}
    try { await this.port.close(); } catch (e) {}
  }
}

/*
 * Bluetooth Low Energy als serielle Strecke. Unterstützt werden
 *   Nordic UART Service (ESP32, nRF52, Adafruit Bluefruit) und
 *   HM-10/HM-19-Module (ein Kanal für beide Richtungen).
 * Klassisches Bluetooth (HC-05) läuft am PC als serieller Anschluss über "USB (seriell)".
 */
const BLE_NUS = { svc: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', rx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', tx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e' };
const BLE_HM10 = { svc: '0000ffe0-0000-1000-8000-00805f9b34fb', rx: '0000ffe1-0000-1000-8000-00805f9b34fb', tx: '0000ffe1-0000-1000-8000-00805f9b34fb' };

class BleDevice {
  constructor() { this.kind = 'ble'; this.onLine = () => {}; this.onClose = () => {}; this.queue = Promise.resolve(); this.buf = ''; }
  async connect() {
    this.dev = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLE_NUS.svc] }, { services: [BLE_HM10.svc] }, { namePrefix: 'ChromaLog' }, { namePrefix: 'HPLC' }],
      optionalServices: [BLE_NUS.svc, BLE_HM10.svc]
    });
    this.name = this.dev.name || '';
    this.dev.addEventListener('gattserverdisconnected', () => { if (this.alive) { this.alive = false; this.onClose(); } });
    const gatt = await this.dev.gatt.connect();
    let prof = BLE_NUS, svc;
    try { svc = await gatt.getPrimaryService(BLE_NUS.svc); }
    catch (e) { prof = BLE_HM10; svc = await gatt.getPrimaryService(BLE_HM10.svc); }
    this.rx = await svc.getCharacteristic(prof.rx);
    const tx = prof.tx === prof.rx ? this.rx : await svc.getCharacteristic(prof.tx);
    const dec = new TextDecoder();
    tx.addEventListener('characteristicvaluechanged', e => {
      this.buf += dec.decode(e.target.value, { stream: true });
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) { const l = this.buf.slice(0, i).replace(/\r$/, ''); this.buf = this.buf.slice(i + 1); this.onLine(l); }
    });
    await tx.startNotifications();
    this.alive = true;
  }
  send(cmd) {
    const bytes = new TextEncoder().encode(cmd + '\n');
    for (let i = 0; i < bytes.length; i += 20) {
      const chunk = bytes.slice(i, i + 20);
      this.queue = this.queue.then(() => this.rx && (this.rx.writeValueWithoutResponse ? this.rx.writeValueWithoutResponse(chunk) : this.rx.writeValue(chunk))).catch(() => {});
    }
  }
  async close() { this.alive = false; try { if (this.dev && this.dev.gatt.connected) this.dev.gatt.disconnect(); } catch (e) {} }
}

if (typeof module !== 'undefined') module.exports = { gradAt, parseLine, SimDevice, simulateRun, SIM_COMPOUNDS };
