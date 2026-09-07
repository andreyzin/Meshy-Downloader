// Мини-мок DOM/chrome: проверяем, что попап находит все свои элементы и корректно
// синхронизирует настройки со страницей.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'popup.html'), 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));

const nodes = new Map();
function mk(id) {
  const n = {
    id, textContent: '', innerHTML: '', value: '', disabled: false, dataset: {},
    className: '', style: {}, children: [],
    classList: { toggle(){}, add(){}, remove(){}, contains(){ return false; } },
    listeners: {},
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    appendChild(c) { this.children.push(c); return c; }
  };
  return n;
}
const missing = [];
global.document = {
  getElementById(id) {
    if (!ids.has(id)) { missing.push(id); }
    if (!nodes.has(id)) nodes.set(id, mk(id));
    return nodes.get(id);
  },
  createElement: () => mk('new'),
  querySelectorAll: () => (nodes.get('formats')?.children || [])
};
let pagePrefs = { format: 'stl', ratio: 45 };
const calls = [];
global.chrome = {
  tabs: { query: async () => [{ id: 7, url: 'https://www.meshy.ai/3d-models/x' }] },
  scripting: {
    executeScript: async ({ func, args }) => {
      const src = func.toString();
      calls.push(src.slice(0, 60));
      if (src.includes('getState')) return [{ result: {
        status: 'ready', glbSize: 5 * 1024 * 1024, modelName: 'dragon',
        texNames: ['a.png'], prefs: pagePrefs } }];
      if (src.includes('setPrefs')) { pagePrefs = args[0]; return [{ result: pagePrefs }]; }
      if (src.includes('analyze')) return [{ result: { triangles: 124500, vertices: 62000 } }];
      if (src.includes('download')) return [{ result: true }];
      return [{ result: undefined }];
    }
  }
};
global.setInterval = () => 0;
global.setTimeout = (f) => { f(); return 0; };

eval(fs.readFileSync(require('path').join(__dirname, '..', 'popup.js'), 'utf8'));

setImmediate(async () => {
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  let fails = 0;
  const ok = (c, m, e='') => { console.log((c?'  ✓ ':'  ✗ ')+m, e); if(!c) fails++; };

  ok(missing.length === 0, 'все id из popup.js есть в popup.html', missing.join(',') || '');
  ok(nodes.get('statusText').textContent === 'Модель перехвачена ✅', 'статус готовности', nodes.get('statusText').textContent);
  ok(nodes.get('formats').children.length === 4, 'четыре кнопки формата');
  ok(nodes.get('ratio').value === '45', 'ползунок подтянул значение со страницы', nodes.get('ratio').value);
  ok(nodes.get('ratioVal').textContent === '45%', 'подпись процента', nodes.get('ratioVal').textContent);
  ok(/124 500 → 56 025 △/.test(nodes.get('stats').textContent), 'счётчик треугольников', nodes.get('stats').textContent);
  ok(nodes.get('btnDl').disabled === false, 'кнопка активна');

  // Смена формата в попапе уходит на страницу
  const objBtn = nodes.get('formats').children.find(c => c.dataset.format === 'obj');
  objBtn.listeners.click[0]();
  await new Promise(r => setImmediate(r));
  ok(pagePrefs.format === 'obj', 'выбор формата сохранён на странице', JSON.stringify(pagePrefs));

  // Ползунок
  const r = nodes.get('ratio');
  r.value = '20';
  r.listeners.input[0]();
  r.listeners.change[0]();
  await new Promise(r2 => setImmediate(r2));
  ok(pagePrefs.ratio === 20, 'детализация сохранена на странице', JSON.stringify(pagePrefs));
  ok(/124 500 → 24 900 △/.test(nodes.get('stats').textContent), 'счётчик пересчитан', nodes.get('stats').textContent);

  // Кнопка скачивания
  await nodes.get('btnDl').listeners.click[0]();
  ok(calls.some(c => c.includes('download')), 'кнопка вызывает download на странице');

  console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nСМОУК ПРОШЁЛ');
  process.exit(fails ? 1 : 0);
});
