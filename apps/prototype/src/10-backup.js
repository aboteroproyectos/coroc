/* COROC · respaldo y restauración (§19): ZIP con manifiesto SHA-256 dentro de un sobre AES-256-GCM */
C.backup = {
  MAGIC: 'COROC-BACKUP-1',
  ITER: 310000,

  async key(password, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: C.backup.ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },

  async create(password, onProgress = () => {}) {
    if (!password || password.length < 10) throw new Error(C.t('La contraseña del respaldo debe tener al menos 10 caracteres.'));
    const zip = new window.JSZip();
    const manifest = { format: C.backup.MAGIC, app: 'COROC', schema: 1, createdAt: C.nowLocal(), company: C.state.company.name, counts: {}, files: {} };
    const add = async (path, content) => {
      const blob = content instanceof Blob ? content : new Blob([content], { type: 'application/json' });
      manifest.files[path] = { sha256: await C.sha256(blob), size: blob.size };
      zip.file(path, blob);
    };
    const stores = ['kv', 'users', 'clients', 'loans', 'documents', 'inbox', 'messages', 'audit'];
    for (const s of stores) {
      let rows = await C.db.all(s);
      if (s === 'kv') rows = rows.filter((r) => r.key !== 'folderHandle');
      manifest.counts[s] = rows.length;
      await add(`data/${s}.json`, JSON.stringify(rows));
    }
    const docs = await C.db.all('documents');
    let i = 0;
    for (const d of docs) {
      const blob = await C.docs.blob(d.id);
      if (blob) await add(`files/${d.id}`, blob);
      onProgress(Math.round((++i / Math.max(1, docs.length)) * 80));
    }
    zip.file('manifest.json', JSON.stringify(manifest, null, 1));
    const plain = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }, (m) => onProgress(80 + Math.round(m.percent * 0.15)));
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await C.backup.key(password, salt), plain);
    const head = JSON.stringify({ format: C.backup.MAGIC, kdf: 'PBKDF2-SHA256', iterations: C.backup.ITER, cipher: 'AES-256-GCM', salt: C.b64.enc(salt), iv: C.b64.enc(iv), createdAt: manifest.createdAt, company: manifest.company, counts: manifest.counts });
    onProgress(100);
    const stamp = C.nowLocal().replace(/[-:]/g, '').replace('T', '_');
    const safeCo = C.sanitizeFolder(C.state.company.name).replace(/\s+/g, '_');
    const name = `COROC_Respaldo_${safeCo}_${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}_${stamp.slice(9, 13)}.coroc`;
    const blob = new Blob([head, '\n', new Uint8Array(cipher)], { type: 'application/octet-stream' });
    await C.audit('backup.created', 'backup', name, { counts: manifest.counts });
    if (C.fs.status === 'connected') {
      try {
        await C.fs.write([C.ROOTFOLDERS[C.companyLang()].backups], name, blob);
      } catch (e) {
        console.warn(e);
      }
    }
    return { blob, name, manifest };
  },

  async open(file, password) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const nl = buf.indexOf(10);
    if (nl < 0) throw new Error(C.t('El archivo no es un respaldo de COROC.'));
    let head;
    try {
      head = JSON.parse(new TextDecoder().decode(buf.subarray(0, nl)));
    } catch (e) {
      throw new Error(C.t('El archivo no es un respaldo de COROC.'));
    }
    if (head.format !== C.backup.MAGIC) throw new Error(C.t('El archivo no es un respaldo de COROC.'));
    let plain;
    try {
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: C.b64.dec(head.iv) }, await C.backup.key(password, C.b64.dec(head.salt)), buf.subarray(nl + 1));
    } catch (e) {
      throw new Error(C.t('Contraseña incorrecta o archivo dañado.'));
    }
    const zip = await window.JSZip.loadAsync(plain);
    const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
    const bad = [];
    for (const [path, meta] of Object.entries(manifest.files)) {
      const f = zip.file(path);
      if (!f) {
        bad.push(path);
        continue;
      }
      const blob = await f.async('blob');
      if ((await C.sha256(blob)) !== meta.sha256) bad.push(path);
    }
    if (bad.length) throw new Error(C.t('Integridad fallida en {n} archivos. No se restauró nada.', { n: bad.length }));
    return { head, manifest, zip };
  },

  /** Restauración atómica: reemplaza todas las colecciones (solo Propietario). */
  async restore({ manifest, zip }) {
    const data = {};
    for (const s of Object.keys(manifest.counts)) data[s] = JSON.parse(await zip.file(`data/${s}.json`).async('string'));
    const blobs = [];
    for (const d of data.documents || []) {
      const f = zip.file(`files/${d.id}`);
      if (f) blobs.push({ id: d.id, blob: new Blob([await f.async('uint8array')], { type: d.mime }) });
    }
    const ops = [];
    for (const s of ['kv', 'users', 'clients', 'loans', 'documents', 'blobs', 'inbox', 'messages', 'audit']) {
      const existing = await C.db.all(s);
      for (const r of existing) if (!(s === 'kv' && r.key === 'folderHandle')) ops.push({ store: s, delete: true, key: s === 'kv' ? r.key : r.id });
    }
    for (const s of Object.keys(data)) for (const r of data[s]) ops.push({ store: s, value: r });
    for (const b of blobs) ops.push({ store: 'blobs', value: b });
    await C.db.putMany(ops);
    await C.audit('backup.restored', 'backup', manifest.createdAt, { counts: manifest.counts });
  },
};
