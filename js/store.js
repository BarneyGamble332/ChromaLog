'use strict';
/* Speicher: IndexedDB im Browser, sonst nur im Arbeitsspeicher (dann warnt die App). */
const Store = {
  db: null, mem: { runs: new Map(), methods: new Map(), audit: new Map(), kv: new Map() }, persistent: false,
  async open() {
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('chromalog', 1);
        r.onupgradeneeded = () => { const d = r.result; ['runs', 'methods', 'audit', 'kv'].forEach(s => d.createObjectStore(s, { keyPath: 'id' })); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
        setTimeout(() => rej(new Error('timeout')), 3000);
      });
      this.persistent = true;
    } catch (e) { this.db = null; this.persistent = false; }
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      try { const rq = fn(this.db.transaction(store, mode).objectStore(store)); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }
      catch (e) { rej(e); }
    });
  },
  async put(store, val) { this.mem[store].set(val.id, val); if (this.db) try { await this.tx(store, 'readwrite', s => s.put(val)); } catch (e) {} },
  async del(store, id) { this.mem[store].delete(id); if (this.db) try { await this.tx(store, 'readwrite', s => s.delete(id)); } catch (e) {} },
  async all(store) {
    if (this.db) try { const a = await this.tx(store, 'readonly', s => s.getAll()); a.forEach(v => this.mem[store].set(v.id, v)); } catch (e) {}
    return [...this.mem[store].values()];
  },
  async get(store, id) { if (this.db) try { const v = await this.tx(store, 'readonly', s => s.get(id)); if (v) return v; } catch (e) {} return this.mem[store].get(id); }
};

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

async function sha256(text) {
  try {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) { return null; }
}

async function audit(action, detail) {
  await Store.put('audit', { id: uid(), ts: new Date().toISOString(), action, detail: detail || '' });
}

/* Datei an den Nutzer geben: in Claude über die Download-Freigabe, sonst als normaler Download. */
async function saveFile(name, text) {
  try {
    if (window.claude && window.claude.use) {
      const d = await window.claude.use('downloads');
      if (d) { await d.save({ filename: name, data: text }); return true; }
    }
  } catch (e) { return false; }
  if (typeof isNativeApp === 'function' && isNativeApp()) {
    /* Android-App: in „Dokumente/ChromaLog“ ablegen; geht das nicht, über „Teilen“ weitergeben */
    try { await capP('Filesystem', 'writeFile', { path: 'ChromaLog/' + name, data: text, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true }); if (typeof toast === 'function') toast(t('t_savedto') + ' ' + name); return true; }
    catch (e) {
      try { const w = await capP('Filesystem', 'writeFile', { path: name, data: text, directory: 'CACHE', encoding: 'utf8' }); await capP('Share', 'share', { title: name, files: [w.uri] }); return true; }
      catch (e2) { return false; }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}

if (typeof module !== 'undefined') module.exports = { sha256 };
