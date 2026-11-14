'use strict';
/*
 * Auswahl des seriellen Anschlusses im Linux-Programm.
 * Linux meldet viele alte Anschlüsse (ttyS0 … ttyS31), die es am Rechner gar nicht gibt. Deshalb stehen
 * USB-Geräte vorn, und die übrigen Anschlüsse kommen erst auf Wunsch.
 */
const KNOWN = { 0x2341: 'Arduino', 0x2a03: 'Arduino', 0x1a86: 'CH340', 0x0403: 'FTDI', 0x10c4: 'CP210x', 0x067b: 'Prolific', 0x239a: 'Adafruit', 0x303a: 'Espressif', 0x1b4f: 'SparkFun', 0x16c0: 'Teensy' };
function num(v) { if (v == null || v === '') return null; const n = typeof v === 'number' ? v : /^0x/i.test(String(v)) ? parseInt(v, 16) : parseInt(v, 10); return isFinite(n) ? n : null; }
const hex4 = n => ('0000' + n.toString(16)).slice(-4);
const nameOf = p => String(p.portName || p.portId || '?');
function label(p) {
  const v = num(p.vendorId), pid = num(p.productId), n = nameOf(p);
  return n + (p.displayName && p.displayName !== n ? ' – ' + p.displayName : '') + (v != null ? '  [' + (KNOWN[v] || 'USB') + ' ' + hex4(v) + ':' + hex4(pid || 0) + ']' : '');
}
/* Reihenfolge der übrigen Anschlüsse: erst alles, was kein alter ttyS ist (z. B. rfcomm für Bluetooth), dann ttyS der Nummer nach */
function rank(p) { const m = /ttyS(\d+)$/.exec(nameOf(p)); return m ? 1000 + (+m[1]) : /ACM|USB/i.test(nameOf(p)) ? 0 : 10; }
function sortPorts(list) {
  const usb = [], others = [];
  (list || []).forEach(p => (num(p.vendorId) != null || /tty(ACM|USB)\d+$/.test(nameOf(p)) ? usb : others).push(p));
  usb.sort((a, b) => (KNOWN[num(b.vendorId)] ? 1 : 0) - (KNOWN[num(a.vendorId)] ? 1 : 0) || nameOf(a).localeCompare(nameOf(b)));
  others.sort((a, b) => rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b)));
  /* Genau ein USB-Gerät mit bekanntem Wandler-Chip: das ist der Arduino, ohne Nachfrage nehmen */
  const auto = usb.length === 1 && KNOWN[num(usb[0].vendorId)] ? usb[0] : null;
  return { usb, others, auto };
}
module.exports = { sortPorts, label };
