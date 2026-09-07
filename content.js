// WORLD: MAIN — выполняется в контексте страницы, прямой доступ к window
// run_at: document_start — раньше любого JS страницы
// all_frames: true — просмотрщик 3D может жить в iframe
(function() {
  'use strict';

  const DEBUG = true;
  const log = (...a) => console.log('[Meshy DL]', ...a);
  const dbg = (...a) => { if (DEBUG) console.log('[Meshy DL][dbg]', ...a); };

  const IS_TOP = (() => { try { return window.top === window; } catch (e) { return false; } })();
  const state = { glb: null, textures: [], modelName: '', status: 'idle' };

  const GLTF_MAGIC = 0x46546c67; // 'glTF' в little-endian
  const TEX_RE = /\.(png|jpe?g|webp|ktx2|basis)(\?|$)/i;
  const MODEL_RE = /\.(glb|gltf)(\?|$)/i;

  // ── Определение GLB ───────────────────────────────────────────────────────────
  function isGLB(buf) {
    if (!buf || !buf.byteLength || buf.byteLength < 12) return false;
    try { return new DataView(buf).getUint32(0, true) === GLTF_MAGIC; } catch (e) { return false; }
  }

  function toArrayBuffer(v) {
    if (v instanceof ArrayBuffer) return v;
    if (ArrayBuffer.isView(v)) return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
    return null;
  }

  /** Рекурсивно ищет ArrayBuffer с GLB в структуре любого вида. */
  function scanForGLB(value, depth, seen) {
    if (value == null || depth > 4) return null;
    const buf = toArrayBuffer(value);
    if (buf) return isGLB(buf) ? buf : null;
    if (typeof value !== 'object') return null;
    seen = seen || new Set();
    if (seen.has(value)) return null;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const v of value) { const r = scanForGLB(v, depth + 1, seen); if (r) return r; }
      return null;
    }
    if (value instanceof Map) {
      for (const v of value.values()) { const r = scanForGLB(v, depth + 1, seen); if (r) return r; }
      return null;
    }
    if (value instanceof Blob) { peekBlob(value, 'blob-in-message'); return null; }
    for (const k in value) {
      let v;
      try { v = value[k]; } catch (e) { continue; }
      const r = scanForGLB(v, depth + 1, seen);
      if (r) return r;
    }
    return null;
  }

  function describe(value, depth) {
    depth = depth || 0;
    if (value == null) return String(value);
    if (value instanceof ArrayBuffer) return 'ArrayBuffer(' + value.byteLength + ')';
    if (ArrayBuffer.isView(value)) return value.constructor.name + '(' + value.byteLength + ')';
    if (value instanceof Blob) return 'Blob(' + value.size + ',' + value.type + ')';
    if (typeof value !== 'object' || depth > 2) return typeof value === 'string' ? 'str:' + value.slice(0, 40) : typeof value;
    if (Array.isArray(value)) return '[' + value.slice(0, 5).map(v => describe(v, depth + 1)).join(',') + ']';
    const out = {};
    for (const k in value) { try { out[k] = describe(value[k], depth + 1); } catch (e) {} }
    return out;
  }

  /** Единая точка входа для любого подозрительного сообщения или буфера. */
  function inspect(data, source) {
    if (data == null) return;
    const buf = scanForGLB(data, 0, null);
    if (buf) { captureGLB(buf, source); return; }
    if (DEBUG && data && typeof data === 'object') dbg('message', source, describe(data));
  }

  function peekBlob(blob, source) {
    if (!blob || blob.size < 12) return;
    blob.slice(0, 12).arrayBuffer().then(head => {
      if (!isGLB(head)) return;
      return blob.arrayBuffer().then(full => captureGLB(full, source));
    }).catch(() => {});
  }

  // ── Захват ─────────────────────────────────────────────────────────────────
  function buffersAreEqual(a, b) {
    if (!a || !b || a.byteLength !== b.byteLength) return false;
    const u1 = new Uint8Array(a), u2 = new Uint8Array(b);
    for (let i = 0; i < u1.length; i++) if (u1[i] !== u2[i]) return false;
    return true;
  }

  function captureGLB(buf, source) {
    const newGlb = buf.slice(0);
    if (state.glb && buffersAreEqual(state.glb, newGlb)) return;
    if (state.glb) { log('🔄 Обнаружена новая модель, сброс текстур'); state.textures = []; }

    state.glb = newGlb;
    state.modelName = getModelName();
    state.status = 'ready';
    log('✅ GLB перехвачен через', source, (newGlb.byteLength / 1024 / 1024).toFixed(2), 'MB');
    publish();
  }

  function captureTexture(name, buf, source) {
    if (!name || !buf || !buf.byteLength) return;
    if (state.textures.find(t => t.name === name)) return;
    state.textures.push({ name, buf: buf.slice(0) });
    log('🖼️ Текстура:', name, (buf.byteLength / 1024).toFixed(0), 'KB', '(' + source + ')');
    publish();
  }

  /** Главный фрейм → IndexedDB. Iframe → ретрансляция через postMessage наверх. */
  function publish() {
    if (IS_TOP) {
      saveToIDB().then(() => {
        updateBtn();
        window.dispatchEvent(new CustomEvent('__meshyDLReady'));
      }).catch(e => log('Ошибка IndexedDB', e));
      return;
    }
    try {
      if (state.glb && !state.glbRelayed) {
        state.glbRelayed = true;
        window.top.postMessage({ __meshyDL: 'glb', name: state.modelName, buf: state.glb.slice(0) }, '*');
      }
      for (const t of state.textures) {
        if (t.relayed) continue;
        t.relayed = true;
        window.top.postMessage({ __meshyDL: 'tex', name: t.name, buf: t.buf.slice(0) }, '*');
      }
    } catch (e) { dbg('ретрансляция невозможна', e); }
  }

  if (IS_TOP) {
    window.addEventListener('message', ev => {
      const d = ev.data;
      if (!d || typeof d !== 'object' || !d.__meshyDL) return;
      const buf = toArrayBuffer(d.buf);
      if (!buf) return;
      if (d.__meshyDL === 'glb') {
        if (d.name) state.modelName = d.name;
        captureGLB(buf, 'iframe-relay');
      } else if (d.__meshyDL === 'tex') {
        captureTexture(d.name, buf, 'iframe-relay');
      }
    });
  }

  // ── Патч Worker / MessagePort ──────────────────────────────────────────────
  const wrapped = new WeakMap();

  function patchMessageTarget(proto, label) {
    if (!proto) return;
    const desc = Object.getOwnPropertyDescriptor(proto, 'onmessage');
    if (desc && desc.set) {
      Object.defineProperty(proto, 'onmessage', {
        configurable: true,
        enumerable: desc.enumerable,
        get() { return this.__meshyOnMsg || desc.get.call(this); },
        set(fn) {
          this.__meshyOnMsg = fn;
          if (typeof fn !== 'function') return desc.set.call(this, fn);
          desc.set.call(this, function(ev) { inspect(ev.data, label + '.onmessage'); return fn.apply(this, arguments); });
        }
      });
    }
    const origAdd = proto.addEventListener || EventTarget.prototype.addEventListener;
    const origRemove = proto.removeEventListener || EventTarget.prototype.removeEventListener;
    Object.defineProperty(proto, 'addEventListener', {
      configurable: true, writable: true,
      value: function(type, fn, opts) {
        if (type !== 'message' || !fn) return origAdd.call(this, type, fn, opts);
        let w = wrapped.get(fn);
        if (!w) {
          const cb = typeof fn === 'function' ? fn : fn.handleEvent.bind(fn);
          w = function(ev) { inspect(ev.data, label + '.addEventListener'); return cb.apply(this, arguments); };
          wrapped.set(fn, w);
        }
        return origAdd.call(this, type, w, opts);
      }
    });
    Object.defineProperty(proto, 'removeEventListener', {
      configurable: true, writable: true,
      value: function(type, fn, opts) {
        const w = (type === 'message' && fn && wrapped.get(fn)) || fn;
        return origRemove.call(this, type, w, opts);
      }
    });
  }

  patchMessageTarget(window.Worker && window.Worker.prototype, 'Worker');
  patchMessageTarget(window.MessagePort && window.MessagePort.prototype, 'MessagePort');
  patchMessageTarget(window.BroadcastChannel && window.BroadcastChannel.prototype, 'BroadcastChannel');

  // Лог всех создаваемых воркеров (диагностика: реальное имя воркера расшифровки)
  if (window.Worker) {
    const _Worker = window.Worker;
    class LoggedWorker extends _Worker {
      constructor(url, opts) {
        super(url, opts);
        log('👷 новый Worker:', String(url), opts || '');
      }
    }
    window.Worker = LoggedWorker;
  }

  // ── Патч fetch ─────────────────────────────────────────────────────────────
  const _fetch = window.fetch;
  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
    const resp = await _fetch.apply(this, args);
    try { harvestResponse(url, resp.clone(), 'fetch'); } catch (e) {}
    return resp;
  };

  function harvestResponse(url, resp, source) {
    if (!url || url.indexOf('meshy') === -1) return;
    if (url.indexOf('assets.meshy.ai') !== -1) dbg('asset', source, url.split('?')[0]);
    const isTex = TEX_RE.test(url);
    const isModel = MODEL_RE.test(url) || /\.meshy(\?|$)/i.test(url);
    if (!isTex && !isModel) return;
    resp.arrayBuffer().then(buf => {
      if (isTex) return captureTexture(url.split('/').pop().split('?')[0], buf, source);
      if (isGLB(buf)) captureGLB(buf, source + ':' + url.split('/').pop().split('?')[0]);
      else dbg('ответ не GLB (зашифрован?)', url.split('?')[0], buf.byteLength, 'байт');
    }).catch(() => {});
  }

  // ── Патч XMLHttpRequest ────────────────────────────────────────────────────
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__meshyUrl = String(url || '');
    return _open.apply(this, arguments);
  };
  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('load', () => {
      const url = this.__meshyUrl || '';
      if (!url || url.indexOf('meshy') === -1) return;
      const r = this.response;
      if (r instanceof Blob) { peekBlob(r, 'xhr'); if (TEX_RE.test(url)) r.arrayBuffer().then(b => captureTexture(url.split('/').pop().split('?')[0], b, 'xhr')); return; }
      const buf = toArrayBuffer(r);
      if (!buf) return;
      if (isGLB(buf)) captureGLB(buf, 'xhr:' + url.split('/').pop().split('?')[0]);
      else if (TEX_RE.test(url)) captureTexture(url.split('/').pop().split('?')[0], buf, 'xhr');
      else dbg('xhr', url.split('?')[0], buf.byteLength, 'байт');
    });
    return _send.apply(this, arguments);
  };

  // ── Патч URL.createObjectURL (GLB, переданный в виде Blob) ────────────────
  const _createObjectURL = URL.createObjectURL;
  URL.createObjectURL = function(obj) {
    if (obj instanceof Blob && obj.size > 1024) peekBlob(obj, 'createObjectURL');
    return _createObjectURL.call(this, obj);
  };

  // ── Вспомогательное ────────────────────────────────────────────────────────────────
  function getModelName() {
    const h1 = document.querySelector('h1');
    if (h1 && h1.textContent) {
      const n = h1.textContent.trim().replace(/[^\w\-. ]/g, '_').trim();
      if (n) return n;
    }
    const t = (document.title || '').split('|')[0].trim().replace(/[^\w\-. ]/g, '_').trim();
    return t || 'model';
  }

  // ── IndexedDB ──────────────────────────────────────────────────────────────
  let _db = null;
  function openDB() {
    return new Promise((res, rej) => {
      if (_db) { res(_db); return; }
      const req = indexedDB.open('meshy_dl', 2);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
      };
      req.onerror = () => rej(req.error);
      req.onsuccess = e => {
        const d = e.target.result;
        if (d.objectStoreNames.contains('files')) { _db = d; res(d); return; }
        // База есть, а хранилища нет (её мог создать старый попап) — чиним поднятием версии
        const nextVersion = d.version + 1;
        d.close();
        const up = indexedDB.open('meshy_dl', nextVersion);
        up.onupgradeneeded = ev => {
          const d2 = ev.target.result;
          if (!d2.objectStoreNames.contains('files')) d2.createObjectStore('files');
        };
        up.onsuccess = ev => { _db = ev.target.result; log('🛠️ Хранилище IndexedDB пересоздано'); res(_db); };
        up.onerror = () => rej(up.error);
      };
    });
  }

  async function saveToIDB() {
    const db = await openDB();
    const tx = db.transaction('files', 'readwrite');
    const s = tx.objectStore('files');
    if (state.glb)       s.put(state.glb, 'glb');
    if (state.modelName) s.put(state.modelName, 'modelName');
    s.put(state.textures.map(t => t.name), 'texNames');
    for (const tex of state.textures) s.put(tex.buf, 'tex_' + tex.name);
    s.put({ status: state.status, glbSize: state.glb?.byteLength || 0, texCount: state.textures.length, modelName: state.modelName }, 'meta');
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  }

  function loadButtonPosition() {
    try {
      const saved = localStorage.getItem('__meshyDLBtnPos');
      if (!saved) return null;
      const pos = JSON.parse(saved);
      if (typeof pos.left !== 'number' || typeof pos.top !== 'number') return null;
      return pos;
    } catch (e) {
      return null;
    }
  }

  function saveButtonPosition(pos) {
    try {
      localStorage.setItem('__meshyDLBtnPos', JSON.stringify(pos));
    } catch (e) {}
  }

  // ── Плавающая кнопка ────────────────────────────────────────────────────────
  function injectBtn() {
    if (document.getElementById('__meshyDLBtn')) return;
    const btn = document.createElement('div');
    btn.id = '__meshyDLBtn';
    btn.textContent = '⏳ Meshy DL';
    btn.style.cssText = `
      position:fixed;z-index:2147483647;
      background:#333;color:#fff;font:bold 13px monospace;
      padding:10px 16px;border-radius:8px;cursor:grab;
      box-shadow:0 4px 20px rgba(0,0,0,.5);transition:background .2s,border .2s;
      border:2px solid #555;user-select:none;touch-action:none;
    `;

    const savedPos = loadButtonPosition();
    if (savedPos) {
      btn.style.left = savedPos.left + 'px';
      btn.style.top = savedPos.top + 'px';
    } else {
      btn.style.right = '20px';
      btn.style.bottom = '20px';
    }

    const DRAG_THRESHOLD = 4; // px — ниже этого порога жест считается кликом
    let dragStart = null;
    let origin = null;
    let moved = false;

    btn.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      moved = false;
      btn.setPointerCapture(event.pointerId);
      btn.style.cursor = 'grabbing';
      btn.style.transition = 'none';

      const rect = btn.getBoundingClientRect();
      origin = { x: rect.left, y: rect.top };
      dragStart = { x: event.clientX, y: event.clientY };
    });

    btn.addEventListener('pointermove', event => {
      if (!dragStart) return;
      event.preventDefault();
      const dx = event.clientX - dragStart.x;
      const dy = event.clientY - dragStart.y;
      if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) moved = true;
      const left = Math.max(0, Math.min(window.innerWidth - btn.offsetWidth, origin.x + dx));
      const top = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, origin.y + dy));
      btn.style.left = left + 'px';
      btn.style.top = top + 'px';
      btn.style.right = 'auto';
      btn.style.bottom = 'auto';
    });

    btn.addEventListener('pointerup', event => {
      if (!dragStart) return;
      event.preventDefault();
      btn.releasePointerCapture(event.pointerId);
      btn.style.cursor = 'grab';
      btn.style.transition = 'background .2s,border .2s';
      dragStart = null;
      origin = null;
      if (moved) saveButtonPosition({ left: btn.offsetLeft, top: btn.offsetTop });
    });

    btn.addEventListener('pointercancel', () => {
      if (!dragStart) return;
      btn.style.cursor = 'grab';
      btn.style.transition = 'background .2s,border .2s';
      dragStart = null;
      origin = null;
      if (moved) saveButtonPosition({ left: btn.offsetLeft, top: btn.offsetTop });
    });

    // click приходит уже после pointerup, поэтому решение принимаем по флагу moved
    btn.addEventListener('click', event => {
      if (moved) {
        moved = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (state.status !== 'ready') {
        btn.textContent = '⏳ Ещё не готово...';
        return;
      }
      downloadAll();
    }, true);

    window.addEventListener('__meshyDLReady', updateBtn);

    document.body?.appendChild(btn);
  }

  function downloadAll() {
    if (state.glb) dl(state.glb, state.modelName + '.glb', 'model/gltf-binary');
    state.textures.forEach((t, i) =>
      setTimeout(() => dl(t.buf, t.name, 'image/png'), 300 * (i + 1))
    );
  }

  function dl(buf, name, mime) {
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([buf], { type: mime })),
      download: name
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  function updateBtn() {
    const btn = document.getElementById('__meshyDLBtn');
    if (!btn) return;
    const texInfo = state.textures.length > 0 ? ` + ${state.textures.length} tex` : '';
    btn.textContent = `⬇️ GLB${texInfo} — Скачать`;
    btn.style.background = '#1f6feb';
    btn.style.border = '2px solid #58a6ff';
  }

  // API страницы для попапа: живое состояние надёжнее чтения IndexedDB
  if (IS_TOP) {
    window.__meshyDL = {
      getState: () => ({
        status: state.status,
        glbSize: state.glb ? state.glb.byteLength : 0,
        modelName: state.modelName,
        texNames: state.textures.map(t => t.name)
      }),
      download: () => { downloadAll(); return true; }
    };
  }

  // Кнопка только в главном фрейме
  if (IS_TOP) {
    if (document.body) injectBtn();
    else new MutationObserver((_, obs) => {
      if (document.body) { injectBtn(); obs.disconnect(); }
    }).observe(document.documentElement, { childList: true });
  }

  log('✅ Расширение загружено (MAIN world, document_start,', IS_TOP ? 'главный фрейм' : 'iframe ' + location.href.slice(0, 60), ')');
})();
