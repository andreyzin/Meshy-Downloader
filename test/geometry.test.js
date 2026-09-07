const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'geometry.js'), 'utf8');
eval(src.replace(/if \(typeof window[\s\S]*$/, ''));
const G = __meshyGeomFactory();

// ── Строим GLB: UV-сфера (разделённые вершины, как у Meshy) ─────────────────
function makeSphere(segU, segV) {
  const pos = [], idx = [];
  for (let v = 0; v <= segV; v++) {
    for (let u = 0; u <= segU; u++) {
      const phi = (v / segV) * Math.PI, theta = (u / segU) * 2 * Math.PI;
      pos.push(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
    }
  }
  const at = (u, v) => v * (segU + 1) + u;
  for (let v = 0; v < segV; v++)
    for (let u = 0; u < segU; u++) {
      idx.push(at(u, v), at(u, v + 1), at(u + 1, v));
      idx.push(at(u + 1, v), at(u, v + 1), at(u + 1, v + 1));
    }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}

function buildGLB(mesh, { translate = [0,0,0], scale = [1,1,1] } = {}) {
  const posBytes = Buffer.from(mesh.pos.buffer);
  const idxBytes = Buffer.from(mesh.idx.buffer);
  const pad = n => (4 - (n % 4)) % 4;
  const bin = Buffer.concat([posBytes, Buffer.alloc(pad(posBytes.length)), idxBytes, Buffer.alloc(pad(idxBytes.length))]);
  const idxOffset = posBytes.length + pad(posBytes.length);
  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: translate, scale }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: mesh.pos.length / 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5125, count: mesh.idx.length, type: 'SCALAR' }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes.length },
      { buffer: 0, byteOffset: idxOffset, byteLength: idxBytes.length }
    ],
    buffers: [{ byteLength: bin.length }]
  };
  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  json = Buffer.concat([json, Buffer.alloc(pad(json.length), 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const jc = Buffer.alloc(8); jc.writeUInt32LE(json.length, 0); jc.writeUInt32LE(0x4e4f534a, 4);
  const bc = Buffer.alloc(8); bc.writeUInt32LE(bin.length, 0); bc.writeUInt32LE(0x004e4942, 4);
  const out = Buffer.concat([header, jc, json, bc, bin]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
}

let fails = 0;
const ok = (cond, msg, extra='') => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg, extra); if (!cond) fails++; };

const sphere = makeSphere(48, 32);
const glb = buildGLB(sphere, { translate: [10, 0, 0], scale: [2, 2, 2] });

console.log('== parse + weld ==');
const raw = G.glbToGeometry(glb);
ok(raw.indices.length / 3 === sphere.idx.length / 3, 'треугольники сохранены', raw.indices.length / 3);
let minX = Infinity, maxX = -Infinity;
for (let i = 0; i < raw.positions.length; i += 3) { minX = Math.min(minX, raw.positions[i]); maxX = Math.max(maxX, raw.positions[i]); }
ok(Math.abs(minX - 8) < 1e-3 && Math.abs(maxX - 12) < 1e-3, 'трансформация узла применена', `x∈[${minX.toFixed(3)}, ${maxX.toFixed(3)}]`);

const w = G.weld(raw.positions, raw.indices);
ok(w.positions.length / 3 < raw.positions.length / 3, 'сварка убрала дубли',
   `${raw.positions.length/3} → ${w.positions.length/3} вершин`);

console.log('== analyze ==');
const a = G.analyze(glb);
ok(a.triangles > 0 && a.vertices > 0, 'analyze вернул счётчики', JSON.stringify(a));

console.log('== simplify ==');
for (const ratio of [0.5, 0.25, 0.1]) {
  const t0 = Date.now();
  const s = G.simplify(w.positions, w.indices, ratio);
  const got = s.indices.length / 3, want = Math.round((w.indices.length / 3) * ratio);
  ok(got <= want * 1.15 && got >= want * 0.5, `ratio ${ratio}: ${w.indices.length/3} → ${got} (цель ${want})`, (Date.now()-t0)+'ms');
  let bad = 0;
  for (let i = 0; i < s.indices.length; i++) if (s.indices[i] >= s.positions.length / 3) bad++;
  ok(bad === 0, `ratio ${ratio}: индексы в границах`);
  let degen = 0;
  for (let i = 0; i < s.indices.length; i += 3)
    if (s.indices[i] === s.indices[i+1] || s.indices[i+1] === s.indices[i+2] || s.indices[i] === s.indices[i+2]) degen++;
  ok(degen === 0, `ratio ${ratio}: нет вырожденных треугольников`);
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < s.positions.length; i += 3) { mn = Math.min(mn, s.positions[i]); mx = Math.max(mx, s.positions[i]); }
  ok(mn > 7.5 && mx < 12.5, `ratio ${ratio}: габариты сохранены`, `x∈[${mn.toFixed(2)}, ${mx.toFixed(2)}]`);
}

console.log('== экспорт ==');
const stl = G.convert(glb, 'stl', 0.3, 'sphere');
const stlView = new DataView(stl.buffer);
ok(stl.buffer.byteLength === 84 + stlView.getUint32(80, true) * 50, 'STL: размер = 84 + 50*N', stl.buffer.byteLength);
ok(stlView.getUint32(80, true) === stl.outTris, 'STL: счётчик треугольников совпадает', stl.outTris);

const obj = G.convert(glb, 'obj', 1, 'sphere');
const objText = Buffer.from(obj.buffer).toString('utf8');
const vLines = (objText.match(/^v /gm) || []).length, fLines = (objText.match(/^f /gm) || []).length;
ok(fLines === obj.outTris, 'OBJ: число граней совпадает', fLines);
ok(vLines === obj.vertices, 'OBJ: число вершин совпадает', vLines);
const maxRef = Math.max(...objText.match(/^f .*/gm).slice(0, 500).flatMap(l => l.slice(2).split(' ').map(Number)));
ok(maxRef <= vLines, 'OBJ: индексы 1-based в границах');

const mf = G.convert(glb, '3mf', 0.5, 'sphere');
const zip = Buffer.from(mf.buffer);
ok(zip.readUInt32LE(0) === 0x04034b50, '3MF: сигнатура ZIP');
ok(zip.readUInt32LE(zip.length - 22) === 0x06054b50, '3MF: EOCD на месте');

console.log('== Draco ==');
try {
  const g2 = JSON.parse(JSON.stringify({}));
  const dracoGlb = (() => {
    const mesh = makeSphere(4, 3);
    const b = buildGLB(mesh);
    const s = Buffer.from(b);
    const jsonStart = 20, jsonLen = s.readUInt32LE(12);
    const json = JSON.parse(s.slice(jsonStart, jsonStart + jsonLen).toString('utf8'));
    json.extensionsRequired = ['KHR_draco_mesh_compression'];
    let nj = Buffer.from(JSON.stringify(json), 'utf8');
    nj = Buffer.concat([nj, Buffer.alloc((4 - nj.length % 4) % 4, 0x20)]);
    const rest = s.slice(jsonStart + jsonLen);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + nj.length + rest.length, 8);
    const jc = Buffer.alloc(8); jc.writeUInt32LE(nj.length, 0); jc.writeUInt32LE(0x4e4f534a, 4);
    const out = Buffer.concat([header, jc, nj, rest]);
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.length);
  })();
  G.convert(dracoGlb, 'stl', 1, 'x');
  ok(false, 'Draco должен давать понятную ошибку');
} catch (e) {
  ok(/сжата/.test(e.message), 'Draco: понятная ошибка', e.message);
}

console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : '\nВСЕ ТЕСТЫ ПРОШЛИ');
process.exit(fails ? 1 : 0);
