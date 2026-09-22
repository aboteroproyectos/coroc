/* COROC · carpeta local COROC (§16.2): File System Access en Chrome/Edge de escritorio; ZIP en los demás */
C.fs = {
  root: null,
  status: 'unsupported', // unsupported | disconnected | needs-permission | connected
  supported: () => typeof window.showDirectoryPicker === 'function',

  async init() {
    if (!C.fs.supported()) {
      C.fs.status = 'unsupported';
      return;
    }
    const handle = await C.db.kvGet('folderHandle', null);
    if (!handle) {
      C.fs.status = 'disconnected';
      return;
    }
    C.fs.root = handle;
    const p = await handle.queryPermission({ mode: 'readwrite' });
    C.fs.status = p === 'granted' ? 'connected' : 'needs-permission';
  },

  /** Pide permiso y crea (o reutiliza) la carpeta COROC dentro de la ubicación elegida. */
  async connect() {
    const parent = await window.showDirectoryPicker({ id: 'coroc-root', mode: 'readwrite', startIn: 'documents' });
    const root = parent.name === 'COROC' ? parent : await parent.getDirectoryHandle('COROC', { create: true });
    C.fs.root = root;
    C.fs.status = 'connected';
    await C.db.kvSet('folderHandle', root);
    const R = C.ROOTFOLDERS[C.companyLang()];
    for (const f of Object.values(R)) await root.getDirectoryHandle(C.sanitizeFolder(f), { create: true });
    await C.audit('folder.connected', 'folder', 'COROC', {});
    await C.fs.syncAll();
    C.emit('folder');
  },

  async reauthorize() {
    if (!C.fs.root) return C.fs.connect();
    const p = await C.fs.root.requestPermission({ mode: 'readwrite' });
    C.fs.status = p === 'granted' ? 'connected' : 'needs-permission';
    if (C.fs.status === 'connected') await C.fs.syncAll();
    C.emit('folder');
  },

  async disconnect() {
    C.fs.root = null;
    C.fs.status = C.fs.supported() ? 'disconnected' : 'unsupported';
    await C.db.kvSet('folderHandle', null);
    C.emit('folder');
  },

  async dir(parts) {
    let d = C.fs.root;
    for (const p of parts) d = await d.getDirectoryHandle(C.sanitizeFolder(p), { create: true });
    return d;
  },

  async write(parts, name, blob) {
    const d = await C.fs.dir(parts);
    const fh = await d.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  },

  fileNameFor(doc) {
    return C.sanitizeFolder(doc.name).slice(0, 180) || doc.id;
  },

  async writeDoc(doc, blob) {
    if (C.fs.status !== 'connected' || !blob) {
      doc.folderPending = true;
      return;
    }
    try {
      const parts = C.docs.folderParts(doc).map(C.sanitizeFolder);
      const name = C.fs.fileNameFor(doc);
      const target = [...parts, name].join('/');
      if (doc.folderPath && doc.folderPath !== target) await C.fs.remove(doc.folderPath);
      await C.fs.write(parts, name, blob);
      if (doc.clientId) await C.fs.writeClientMarker(doc.clientId);
      if (doc.loanId) await C.fs.ensureLoanFolders(doc.loanId);
      doc.folderPath = target;
      doc.folderPending = false;
      await C.db.put('documents', doc);
    } catch (e) {
      doc.folderPending = true;
      console.warn('COROC folder write', e);
    }
  },

  /** Cada contrato tiene siempre sus 5 subcarpetas (§16.3), aunque aún estén vacías. */
  async ensureLoanFolders(loanId) {
    const loan = C.loanById(loanId);
    if (!loan || (C.fs._ensured ||= new Set()).has(loanId)) return;
    const c = C.clientById(loan.clientId);
    for (const sub of C.SUBFOLDERS[C.companyLang()]) await C.fs.dir([c.folderName, loan.contract, sub]);
    C.fs._ensured.add(loanId);
  },

  async writeClientMarker(clientId) {
    if (!clientId) return;
    const c = C.clientById(clientId);
    await C.fs.write([c.folderName || C.clientFolderName(c)], '.coroc-id', new Blob([JSON.stringify({ id: c.id, code: c.code })], { type: 'application/json' }));
  },

  async remove(path) {
    try {
      const parts = path.split('/');
      const name = parts.pop();
      const d = await C.fs.dir(parts);
      await d.removeEntry(name);
    } catch (e) {
      /* el archivo pudo haber sido movido por el usuario */
    }
  },

  /** Renombra la carpeta de un cliente cuando cambia su nombre (§16.3): copia y retira la anterior. */
  async renameClientFolder(client, oldName) {
    if (C.fs.status !== 'connected' || !oldName || oldName === client.folderName) return;
    for (const d of C.state.documents.filter((x) => x.clientId === client.id)) {
      const blob = await C.docs.blob(d.id);
      d.folderPath = null;
      await C.fs.writeDoc(d, blob);
    }
    C.fs._ensured = new Set();
    try {
      await C.fs.root.removeEntry(oldName, { recursive: true });
    } catch (e) {
      /* sin permisos para retirar la carpeta anterior */
    }
  },

  async syncAll() {
    if (C.fs.status !== 'connected') return 0;
    let n = 0;
    for (const d of C.state.documents) {
      if (d.superseded || (d.folderPath && !d.folderPending)) continue;
      await C.fs.writeDoc(d, await C.docs.blob(d.id));
      n++;
    }
    return n;
  },

  /** Carpeta vigilada (§12.5): _Entrada y "02 Comprobantes recibidos" de cada cliente. */
  async scan() {
    if (C.fs.status !== 'connected') return 0;
    const known = new Set(C.state.documents.map((d) => d.sha256));
    const lang = C.companyLang();
    const found = [];
    const walk = async (dirHandle, clientId, rel) => {
      for await (const [name, h] of dirHandle.entries()) {
        if (h.kind !== 'file' || name.startsWith('.') || !/\.(jpe?g|png|webp|heic|pdf)$/i.test(name)) continue;
        const file = await h.getFile();
        const sha = await C.sha256(file);
        if (known.has(sha)) continue;
        known.add(sha);
        found.push({ file, clientId, rel: `${rel}/${name}` });
      }
    };
    try {
      await walk(await C.fs.dir([C.ROOTFOLDERS[lang].inbox]), null, C.sanitizeFolder(C.ROOTFOLDERS[lang].inbox));
      for (const c of C.state.clients) {
        for (const loan of C.loansOf(c.id)) {
          const parts = [c.folderName, loan.contract, C.SUBFOLDERS[lang][1]].map(C.sanitizeFolder);
          let d;
          try {
            d = await C.fs.root.getDirectoryHandle(parts[0]);
            d = await d.getDirectoryHandle(parts[1]);
            d = await d.getDirectoryHandle(parts[2]);
          } catch (e) {
            continue;
          }
          await walk(d, c.id, parts.join('/'));
        }
      }
    } catch (e) {
      console.warn('COROC scan', e);
    }
    for (const f of found) await C.intake.receive(f.file, { source: 'folder', clientId: f.clientId || undefined, folderPath: f.rel });
    return found.length;
  },

  /** Exporta la estructura COROC completa como ZIP (móviles y navegadores sin acceso a carpetas). */
  async exportZip() {
    const zip = new window.JSZip();
    const root = zip.folder('COROC');
    const R = C.ROOTFOLDERS[C.companyLang()];
    Object.values(R).forEach((f) => root.folder(C.sanitizeFolder(f)));
    for (const d of C.state.documents) {
      if (d.superseded) continue;
      const blob = await C.docs.blob(d.id);
      if (!blob) continue;
      root.file([...C.docs.folderParts(d).map(C.sanitizeFolder), C.fs.fileNameFor(d)].join('/'), blob);
    }
    for (const c of C.state.clients) root.file(`${c.folderName}/.coroc-id`, JSON.stringify({ id: c.id, code: c.code }));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  },
};
