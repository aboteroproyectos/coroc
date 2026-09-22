/* COROC · lectura de texto: OCR de imágenes (Tesseract.js) y capa de texto de PDF (PDF.js).
   Se cargan bajo demanda desde CDN la primera vez que se necesitan; sin conexión, la bandeja pide los datos a mano. */
C.OCR_CONFIG = C.OCR_CONFIG || {
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  langs: 'spa+por+eng',
  pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs',
  pdfjsWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs',
};

C.ocr = {
  _tess: null,
  _worker: null,
  _pdf: null,
  loadScript: (src) =>
    new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error(C.t('No se pudo cargar el lector de documentos (¿sin conexión?).')));
      document.head.appendChild(s);
    }),

  async worker(onProgress) {
    if (this._worker) return this._worker;
    if (!window.Tesseract) await this.loadScript(C.OCR_CONFIG.tesseract);
    const opts = { logger: (m) => onProgress && m.status === 'recognizing text' && onProgress(Math.round(m.progress * 100)) };
    if (C.OCR_CONFIG.workerPath) opts.workerPath = C.OCR_CONFIG.workerPath;
    if (C.OCR_CONFIG.corePath) opts.corePath = C.OCR_CONFIG.corePath;
    if (C.OCR_CONFIG.langPath) opts.langPath = C.OCR_CONFIG.langPath;
    this._worker = await window.Tesseract.createWorker(C.OCR_CONFIG.langs.split('+'), 1, opts);
    return this._worker;
  },

  /** Mejora el contraste y la escala antes del OCR (§13.2). */
  async preprocess(blob) {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(2.5, Math.max(1, 1800 / Math.max(bmp.width, bmp.height)));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * scale);
    cv.height = Math.round(bmp.height * scale);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
    const img = ctx.getImageData(0, 0, cv.width, cv.height);
    const d = img.data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const mean = sum / (d.length / 4);
    const invert = mean < 110; // capturas en modo oscuro
    for (let i = 0; i < d.length; i += 4) {
      let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (invert) g = 255 - g;
      g = Math.max(0, Math.min(255, (g - 128) * 1.35 + 128));
      d[i] = d[i + 1] = d[i + 2] = g;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  },

  async imageText(blob, onProgress) {
    const w = await this.worker(onProgress);
    const canvas = await this.preprocess(blob);
    const { data } = await w.recognize(canvas);
    return data.text || '';
  },

  async pdfLib() {
    if (this._pdf) return this._pdf;
    const lib = await import(/* @vite-ignore */ C.OCR_CONFIG.pdfjs);
    lib.GlobalWorkerOptions.workerSrc = C.OCR_CONFIG.pdfjsWorker;
    this._pdf = lib;
    return lib;
  },

  /** PDF con capa de texto → extracción directa; PDF escaneado → se renderiza y pasa por OCR. */
  async pdfText(blob, onProgress) {
    const lib = await this.pdfLib();
    const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    let out = '';
    const pages = Math.min(pdf.numPages, 3);
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      let lastY = null;
      for (const it of tc.items) {
        const y = it.transform ? Math.round(it.transform[5]) : null;
        out += lastY !== null && y !== null && Math.abs(y - lastY) > 2 ? '\n' : ' ';
        out += it.str;
        lastY = y;
      }
      out += '\n';
    }
    if (out.replace(/\s/g, '').length > 20) return out;
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 2 });
    const cv = document.createElement('canvas');
    cv.width = vp.width;
    cv.height = vp.height;
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    const png = await new Promise((r) => cv.toBlob(r, 'image/png'));
    return this.imageText(png, onProgress);
  },
};
