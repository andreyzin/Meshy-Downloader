const FORMATS = ['glb', 'stl', 'obj', '3mf'];

let currentTabId = null;
let pageState = null;
let prefs = { format: 'glb', ratio: 100 };
let lastLocalEdit = 0;      // не затирать ввод пользователя фоновым обновлением
let analysisCache = null;   // { glbSize, triangles }

/** Выполняет код в главном фрейме страницы (world MAIN). */
async function onPage(func, args = []) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: currentTabId },
    world: 'MAIN',
    func,
    args
  });
  return res?.result;
}

function setStatus(type, text) {
  document.getElementById('dot').className = 'dot dot-' + type;
  document.getElementById('statusText').textContent = text;
}

function buildFormats() {
  const box = document.getElementById('formats');
  FORMATS.forEach(f => {
    const b = document.createElement('div');
    b.className = 'fmt';
    b.dataset.format = f;
    b.textContent = f.toUpperCase();
    b.addEventListener('click', () => {
      prefs.format = f;
      lastLocalEdit = Date.now();
      paintPrefs();
      pushPrefs();
      renderStats();
    });
    box.appendChild(b);
  });

  const ratio = document.getElementById('ratio');
  ratio.addEventListener('input', () => {
    prefs.ratio = Number(ratio.value);
    lastLocalEdit = Date.now();
    document.getElementById('ratioVal').textContent = prefs.ratio + '%';
    renderStats();
  });
  ratio.addEventListener('change', () => {
    lastLocalEdit = Date.now();
    pushPrefs();
  });
}

function paintPrefs() {
  document.querySelectorAll('.fmt').forEach(b => {
    b.classList.toggle('active', b.dataset.format === prefs.format);
  });
  const ratio = document.getElementById('ratio');
  ratio.value = String(prefs.ratio);
  ratio.disabled = prefs.format === 'glb';
  document.getElementById('ratioVal').textContent = prefs.ratio + '%';
  document.getElementById('ratioRow').classList.toggle('dim', prefs.format === 'glb');
}

/** Настройки хранит страница (localStorage), попап лишь синхронизируется с ней. */
async function pushPrefs() {
  if (!currentTabId) return;
  await onPage(p => window.__meshyDL?.setPrefs(p), [prefs]);
}

async function renderStats() {
  const stats = document.getElementById('stats');
  if (prefs.format === 'glb') {
    stats.textContent = pageState?.texNames?.length
      ? `Исходный GLB + ${pageState.texNames.length} текстур`
      : 'Исходный GLB без изменений';
    return;
  }
  if (!pageState?.glbSize) { stats.textContent = 'Модель ещё не перехвачена'; return; }

  if (analysisCache?.glbSize !== pageState.glbSize) {
    stats.textContent = 'Подсчёт треугольников...';
    const a = await onPage(() => window.__meshyDL?.analyze());
    if (!a || a.error) { stats.textContent = 'Разбор не удался: ' + (a?.error || '').slice(0, 40); return; }
    analysisCache = { glbSize: pageState.glbSize, triangles: a.triangles };
  }
  const target = Math.max(4, Math.round(analysisCache.triangles * prefs.ratio / 100));
  const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  stats.textContent = `${fmt(analysisCache.triangles)} → ${fmt(target)} △`;
}

function render(st) {
  const list = document.getElementById('fileList');
  list.innerHTML = '';
  if (!st || !st.glbSize) return;

  list.innerHTML += `<div class="file-row">
    <span>📄 ${st.modelName || 'model'}.glb <span class="badge badge-glb">GLB</span></span>
    <span style="color:#8b949e">${(st.glbSize/1024/1024).toFixed(1)} MB</span>
  </div>`;

  (st.texNames || []).forEach(name => {
    list.innerHTML += `<div class="file-row">
      <span>🖼️ ${name} <span class="badge badge-tex">PNG</span></span>
    </div>`;
  });

  document.getElementById('btnDl').disabled = false;
}

async function refresh() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes('meshy.ai')) {
      setStatus('idle', 'Это не страница Meshy');
      return;
    }
    currentTabId = tab.id;

    const st = await onPage(() => {
      if (window.__meshyDL?.getState) return window.__meshyDL.getState();
      return { error: 'no-script' };
    });
    pageState = st || { error: 'no-result' };

    if (pageState.error === 'no-script') {
      setStatus('error', 'Скрипт не загружен');
      document.getElementById('hint').textContent =
        '💡 Перезагрузите страницу Meshy после установки или обновления расширения.';
      return;
    }
    if (pageState.error) {
      setStatus('error', 'Нет ответа от страницы');
      return;
    }

    if (pageState.prefs && Date.now() - lastLocalEdit > 3000) {
      prefs = pageState.prefs;
      paintPrefs();
    }

    if (pageState.status === 'ready' && pageState.glbSize > 0) {
      setStatus('ready', 'Модель перехвачена ✅');
      render(pageState);
      document.getElementById('hint').textContent = `Перехвачено текстур: ${(pageState.texNames || []).length}.`;
    } else {
      setStatus('waiting', 'Ожидание модели...');
      document.getElementById('btnDl').disabled = true;
      document.getElementById('hint').textContent =
        '💡 Дайте просмотрщику 3D полностью загрузить модель.';
    }
    renderStats();
  } catch(e) {
    setStatus('error', 'Ошибка: ' + e.message.slice(0, 40));
  }
}

async function downloadAll() {
  if (!currentTabId || !pageState?.glbSize) return;
  const btn = document.getElementById('btnDl');
  btn.disabled = true;
  btn.textContent = prefs.format === 'glb' ? '⏳ ...' : '⏳ Конвертация...';

  await pushPrefs();
  await onPage(() => { window.__meshyDL?.download(); });

  btn.textContent = '✅ Отправлено в загрузки';
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = '⬇️ Скачать';
  }, 2500);
}

document.getElementById('btnDl').addEventListener('click', downloadAll);
buildFormats();
paintPrefs();
refresh();
setInterval(refresh, 2500);
