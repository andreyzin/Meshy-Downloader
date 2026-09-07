let currentTabId = null;
let pageState = null;

/** Читает живое состояние из главного фрейма страницы. */
async function readFromPage(tabId) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      if (window.__meshyDL && window.__meshyDL.getState) return window.__meshyDL.getState();
      return { error: 'no-script' };
    }
  });
  return res?.result || { error: 'no-result' };
}

function setStatus(type, text) {
  document.getElementById('dot').className = 'dot dot-' + type;
  document.getElementById('statusText').textContent = text;
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

    const st = await readFromPage(tab.id);
    pageState = st;

    if (st.error === 'no-script') {
      setStatus('error', 'Скрипт не загружен');
      document.getElementById('hint').textContent =
        '💡 Перезагрузите страницу Meshy после установки или обновления расширения.';
      return;
    }
    if (st.error) {
      setStatus('error', 'Нет ответа от страницы');
      return;
    }

    if (st.status === 'ready' && st.glbSize > 0) {
      setStatus('ready', 'Модель перехвачена ✅');
      render(st);
      document.getElementById('hint').textContent = `Перехвачено текстур: ${(st.texNames || []).length}.`;
    } else {
      setStatus('waiting', 'Ожидание модели...');
      document.getElementById('btnDl').disabled = true;
      document.getElementById('hint').textContent =
        '💡 Дайте просмотрщику 3D полностью загрузить модель.';
    }
  } catch(e) {
    setStatus('error', 'Ошибка: ' + e.message.slice(0, 40));
  }
}

window.downloadAll = async function() {
  if (!currentTabId || !pageState?.glbSize) return;
  const btn = document.getElementById('btnDl');
  btn.disabled = true;
  btn.textContent = '⏳ ...';

  await chrome.scripting.executeScript({
    target: { tabId: currentTabId },
    world: 'MAIN',
    func: () => { window.__meshyDL?.download(); }
  });

  btn.textContent = '✅ Скачано!';
  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = '⬇️ Скачать всё';
  }, 2000);
};

refresh();
setInterval(refresh, 2500);
