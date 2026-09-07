// Геометрический модуль: разбор GLB, сварка вершин, упрощение (QEM), экспорт.
// Объявлен как фабрика, чтобы тот же исходник можно было передать в Worker
// через Function.prototype.toString() и не дублировать код.
function __meshyGeomFactory() {
  'use strict';

  const GLTF_MAGIC = 0x46546c67;
  const CHUNK_JSON = 0x4e4f534a;
  const CHUNK_BIN  = 0x004e4942;

  const COMPONENT = {
    5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
    5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array
  };
  const COMPONENT_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

  // ── Матрицы 4x4 (column-major, как в glTF) ─────────────────────────────────
  function mat4Identity() {
    return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  function mat4Multiply(a, b) {
    const o = new Float64Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    }
    return o;
  }

  function mat4FromTRS(t, q, s) {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const m = new Float64Array(16);
    m[0] = (1 - (yy + zz)) * s[0]; m[1] = (xy + wz) * s[0];       m[2] = (xz - wy) * s[0];       m[3] = 0;
    m[4] = (xy - wz) * s[1];       m[5] = (1 - (xx + zz)) * s[1]; m[6] = (yz + wx) * s[1];       m[7] = 0;
    m[8] = (xz + wy) * s[2];       m[9] = (yz - wx) * s[2];       m[10] = (1 - (xx + yy)) * s[2]; m[11] = 0;
    m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
    return m;
  }

  // ── Разбор GLB ─────────────────────────────────────────────────────────────
  function splitGLB(buffer) {
    const dv = new DataView(buffer);
    if (buffer.byteLength < 12 || dv.getUint32(0, true) !== GLTF_MAGIC) {
      throw new Error('Файл не является GLB');
    }
    const total = Math.min(dv.getUint32(8, true), buffer.byteLength);
    let off = 12, gltf = null, binStart = -1;
    while (off + 8 <= total) {
      const len = dv.getUint32(off, true);
      const type = dv.getUint32(off + 4, true);
      const start = off + 8;
      if (type === CHUNK_JSON) {
        gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, len)));
      } else if (type === CHUNK_BIN && binStart < 0) {
        binStart = start;
      }
      off = start + len;
    }
    if (!gltf) throw new Error('В GLB нет JSON-чанка');
    return { gltf, binStart: binStart < 0 ? 0 : binStart };
  }

  /** Читает аксессор в типизированный массив, разворачивая byteStride. */
  function readAccessor(gltf, buffer, binStart, index) {
    const acc = gltf.accessors[index];
    if (!acc) throw new Error('Аксессор ' + index + ' отсутствует');
    if (acc.sparse) throw new Error('Sparse-аксессоры не поддерживаются');
    const comps = COMPONENT_COUNT[acc.type];
    const Ctor = COMPONENT[acc.componentType];
    if (!comps || !Ctor) throw new Error('Неизвестный тип аксессора');

    const out = new Ctor(acc.count * comps);
    if (acc.bufferView === undefined) return out;

    const bv = gltf.bufferViews[acc.bufferView];
    const base = binStart + (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const elemSize = Ctor.BYTES_PER_ELEMENT * comps;
    const stride = bv.byteStride || elemSize;
    const aligned = base % Ctor.BYTES_PER_ELEMENT === 0;

    if (aligned && stride === elemSize) {
      out.set(new Ctor(buffer, base, acc.count * comps));
      return out;
    }
    if (aligned) {
      for (let i = 0; i < acc.count; i++) {
        out.set(new Ctor(buffer, base + i * stride, comps), i * comps);
      }
      return out;
    }
    // Невыровненные данные читаем побайтово
    const dv = new DataView(buffer);
    const readers = {
      5120: (o) => dv.getInt8(o), 5121: (o) => dv.getUint8(o),
      5122: (o) => dv.getInt16(o, true), 5123: (o) => dv.getUint16(o, true),
      5125: (o) => dv.getUint32(o, true), 5126: (o) => dv.getFloat32(o, true)
    };
    const read = readers[acc.componentType];
    for (let i = 0; i < acc.count; i++) {
      for (let c = 0; c < comps; c++) {
        out[i * comps + c] = read(base + i * stride + c * Ctor.BYTES_PER_ELEMENT);
      }
    }
    return out;
  }

  /**
   * Собирает всю треугольную геометрию GLB в один меш в мировых координатах.
   * Возвращает { positions: Float32Array, indices: Uint32Array }.
   */
  function glbToGeometry(buffer) {
    const { gltf, binStart } = splitGLB(buffer);

    const required = gltf.extensionsRequired || [];
    const blocked = required.filter(e =>
      e === 'KHR_draco_mesh_compression' || e === 'EXT_meshopt_compression');
    if (blocked.length) {
      throw new Error('Геометрия сжата (' + blocked.join(', ') + '), конвертация невозможна');
    }

    const parts = [];
    let totalVerts = 0, totalIndices = 0;

    const collectMesh = (meshIndex, world) => {
      const mesh = gltf.meshes && gltf.meshes[meshIndex];
      if (!mesh) return;
      for (const prim of mesh.primitives || []) {
        if (prim.mode !== undefined && prim.mode !== 4) continue; // только TRIANGLES
        const posIdx = prim.attributes && prim.attributes.POSITION;
        if (posIdx === undefined) continue;

        const pos = readAccessor(gltf, buffer, binStart, posIdx);
        let idx;
        if (prim.indices !== undefined) {
          const raw = readAccessor(gltf, buffer, binStart, prim.indices);
          idx = raw instanceof Uint32Array ? raw : Uint32Array.from(raw);
        } else {
          idx = new Uint32Array(pos.length / 3);
          for (let i = 0; i < idx.length; i++) idx[i] = i;
        }
        parts.push({ pos, idx, world });
        totalVerts += pos.length / 3;
        totalIndices += idx.length;
      }
    };

    const nodes = gltf.nodes || [];
    const visit = (nodeIndex, parentMat, depth) => {
      const node = nodes[nodeIndex];
      if (!node || depth > 64) return;
      const local = node.matrix
        ? Float64Array.from(node.matrix)
        : mat4FromTRS(node.translation || [0, 0, 0], node.rotation || [0, 0, 0, 1], node.scale || [1, 1, 1]);
      const world = mat4Multiply(parentMat, local);
      if (node.mesh !== undefined) collectMesh(node.mesh, world);
      for (const child of node.children || []) visit(child, world, depth + 1);
    };

    const scene = gltf.scenes && gltf.scenes[gltf.scene || 0];
    const roots = (scene && scene.nodes) || nodes.map((_, i) => i);
    if (roots.length) {
      for (const r of roots) visit(r, mat4Identity(), 0);
    } else {
      (gltf.meshes || []).forEach((_, i) => collectMesh(i, mat4Identity()));
    }
    if (!parts.length) throw new Error('В модели не найдено треугольной геометрии');

    const positions = new Float32Array(totalVerts * 3);
    const indices = new Uint32Array(totalIndices);
    let vOff = 0, iOff = 0;
    for (const part of parts) {
      const m = part.world;
      const n = part.pos.length / 3;
      for (let i = 0; i < n; i++) {
        const x = part.pos[i * 3], y = part.pos[i * 3 + 1], z = part.pos[i * 3 + 2];
        const o = (vOff + i) * 3;
        positions[o]     = m[0] * x + m[4] * y + m[8]  * z + m[12];
        positions[o + 1] = m[1] * x + m[5] * y + m[9]  * z + m[13];
        positions[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      for (let i = 0; i < part.idx.length; i++) indices[iOff + i] = part.idx[i] + vOff;
      vOff += n;
      iOff += part.idx.length;
    }
    return { positions, indices };
  }

  // ── Сварка вершин ──────────────────────────────────────────────────────────
  /**
   * Склеивает совпадающие вершины (GLB рвёт их по UV-швам) и выбрасывает
   * вырожденные треугольники. Без этого упрощение разваливает сетку.
   */
  function weld(positions, indices, epsilon) {
    let eps = epsilon;
    if (!eps) {
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        if (positions[i] < minX) minX = positions[i];
        if (positions[i] > maxX) maxX = positions[i];
        if (positions[i + 1] < minY) minY = positions[i + 1];
        if (positions[i + 1] > maxY) maxY = positions[i + 1];
        if (positions[i + 2] < minZ) minZ = positions[i + 2];
        if (positions[i + 2] > maxZ) maxZ = positions[i + 2];
      }
      const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
      eps = diag * 1e-6;
    }
    const inv = 1 / eps;
    const map = new Map();
    const remap = new Uint32Array(positions.length / 3);
    const outPos = new Float32Array(positions.length);
    let count = 0;

    for (let v = 0; v < remap.length; v++) {
      const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
      const key = Math.round(x * inv) + '|' + Math.round(y * inv) + '|' + Math.round(z * inv);
      let id = map.get(key);
      if (id === undefined) {
        id = count++;
        map.set(key, id);
        outPos[id * 3] = x; outPos[id * 3 + 1] = y; outPos[id * 3 + 2] = z;
      }
      remap[v] = id;
    }

    const outIdx = new Uint32Array(indices.length);
    let n = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const a = remap[indices[i]], b = remap[indices[i + 1]], c = remap[indices[i + 2]];
      if (a === b || b === c || a === c) continue;
      outIdx[n++] = a; outIdx[n++] = b; outIdx[n++] = c;
    }
    return { positions: outPos.slice(0, count * 3), indices: outIdx.slice(0, n) };
  }

  // ── Упрощение: Quadric Error Metrics (Garland-Heckbert) ────────────────────
  function quadricError(Q, o, x, y, z) {
    return Q[o] * x * x + 2 * Q[o + 1] * x * y + 2 * Q[o + 2] * x * z + 2 * Q[o + 3] * x
      + Q[o + 4] * y * y + 2 * Q[o + 5] * y * z + 2 * Q[o + 6] * y
      + Q[o + 7] * z * z + 2 * Q[o + 8] * z + Q[o + 9];
  }

  /** Минимальная двоичная куча по полю cost. */
  function makeHeap() {
    const a = [];
    const up = (i) => {
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].cost <= a[i].cost) break;
        const t = a[p]; a[p] = a[i]; a[i] = t;
        i = p;
      }
    };
    const down = (i) => {
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].cost < a[m].cost) m = l;
        if (r < a.length && a[r].cost < a[m].cost) m = r;
        if (m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t;
        i = m;
      }
    };
    return {
      get size() { return a.length; },
      push(item) { a.push(item); up(a.length - 1); },
      pop() {
        const top = a[0], last = a.pop();
        if (a.length) { a[0] = last; down(0); }
        return top;
      }
    };
  }

  /**
   * Схлопывание рёбер по квадратичной ошибке до targetRatio треугольников.
   * Схлопывания, переворачивающие нормали, отклоняются.
   */
  function simplify(positions, indices, targetRatio, onProgress) {
    const triCount = indices.length / 3;
    const target = Math.max(4, Math.round(triCount * targetRatio));
    if (target >= triCount) return { positions, indices };

    const nv = positions.length / 3;
    const pos = Float64Array.from(positions);
    const tris = Uint32Array.from(indices);
    const triDead = new Uint8Array(triCount);
    const vertDead = new Uint8Array(nv);
    const version = new Uint32Array(nv);
    const Q = new Float64Array(nv * 10);
    const vertTris = new Array(nv);
    for (let i = 0; i < nv; i++) vertTris[i] = [];

    const addQuadric = (v, a, b, c, d) => {
      const o = v * 10;
      Q[o]     += a * a; Q[o + 1] += a * b; Q[o + 2] += a * c; Q[o + 3] += a * d;
      Q[o + 4] += b * b; Q[o + 5] += b * c; Q[o + 6] += b * d;
      Q[o + 7] += c * c; Q[o + 8] += c * d; Q[o + 9] += d * d;
    };

    const triNormal = (t, out) => {
      const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const e1x = pos[b * 3] - ax, e1y = pos[b * 3 + 1] - ay, e1z = pos[b * 3 + 2] - az;
      const e2x = pos[c * 3] - ax, e2y = pos[c * 3 + 1] - ay, e2z = pos[c * 3 + 2] - az;
      out[0] = e1y * e2z - e1z * e2y;
      out[1] = e1z * e2x - e1x * e2z;
      out[2] = e1x * e2y - e1y * e2x;
      return Math.hypot(out[0], out[1], out[2]);
    };

    const nrm = new Float64Array(3);
    for (let t = 0; t < triCount; t++) {
      const len = triNormal(t, nrm);
      const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
      vertTris[a].push(t); vertTris[b].push(t); vertTris[c].push(t);
      if (len === 0) continue;
      const nx = nrm[0] / len, ny = nrm[1] / len, nz = nrm[2] / len;
      const d = -(nx * pos[a * 3] + ny * pos[a * 3 + 1] + nz * pos[a * 3 + 2]);
      addQuadric(a, nx, ny, nz, d);
      addQuadric(b, nx, ny, nz, d);
      addQuadric(c, nx, ny, nz, d);
    }

    const sumQ = new Float64Array(10);
    const best = new Float64Array(3);

    /** Лучшая позиция слияния из трёх кандидатов и её ошибка. */
    const evaluate = (u, v) => {
      const ou = u * 10, ov = v * 10;
      for (let i = 0; i < 10; i++) sumQ[i] = Q[ou + i] + Q[ov + i];
      const ux = pos[u * 3], uy = pos[u * 3 + 1], uz = pos[u * 3 + 2];
      const vx = pos[v * 3], vy = pos[v * 3 + 1], vz = pos[v * 3 + 2];
      const cands = [ux, uy, uz, vx, vy, vz, (ux + vx) / 2, (uy + vy) / 2, (uz + vz) / 2];
      let bestCost = Infinity, bi = 0;
      for (let i = 0; i < 3; i++) {
        const c = quadricError(sumQ, 0, cands[i * 3], cands[i * 3 + 1], cands[i * 3 + 2]);
        if (c < bestCost) { bestCost = c; bi = i; }
      }
      best[0] = cands[bi * 3]; best[1] = cands[bi * 3 + 1]; best[2] = cands[bi * 3 + 2];
      return bestCost;
    };

    const heap = makeHeap();
    const pushEdge = (u, v) => {
      if (u === v || vertDead[u] || vertDead[v]) return;
      const cost = evaluate(u, v);
      heap.push({ cost, u, v, vu: version[u], vv: version[v], x: best[0], y: best[1], z: best[2] });
    };

    const seen = new Set();
    for (let t = 0; t < triCount; t++) {
      const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
      const pairs = [[a, b], [b, c], [a, c]];
      for (const [p, q] of pairs) {
        const lo = Math.min(p, q), hi = Math.max(p, q);
        const key = lo * nv + hi;
        if (seen.has(key)) continue;
        seen.add(key);
        pushEdge(lo, hi);
      }
    }
    seen.clear();

    /** Проверяет, что после переноса вершины ни один треугольник не вывернется. */
    const flips = (u, v, x, y, z) => {
      const n0 = new Float64Array(3), n1 = new Float64Array(3);
      for (const src of [u, v]) {
        for (const t of vertTris[src]) {
          if (triDead[t]) continue;
          const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
          const hasU = a === u || b === u || c === u;
          const hasV = a === v || b === v || c === v;
          if (hasU && hasV) continue; // треугольник исчезнет вместе с ребром
          const len0 = triNormal(t, n0);
          if (len0 === 0) continue;
          const ids = [a, b, c];
          const px = [0, 0, 0], py = [0, 0, 0], pz = [0, 0, 0];
          for (let i = 0; i < 3; i++) {
            const id = ids[i];
            if (id === u || id === v) { px[i] = x; py[i] = y; pz[i] = z; }
            else { px[i] = pos[id * 3]; py[i] = pos[id * 3 + 1]; pz[i] = pos[id * 3 + 2]; }
          }
          const e1x = px[1] - px[0], e1y = py[1] - py[0], e1z = pz[1] - pz[0];
          const e2x = px[2] - px[0], e2y = py[2] - py[0], e2z = pz[2] - pz[0];
          n1[0] = e1y * e2z - e1z * e2y;
          n1[1] = e1z * e2x - e1x * e2z;
          n1[2] = e1x * e2y - e1y * e2x;
          const len1 = Math.hypot(n1[0], n1[1], n1[2]);
          if (len1 === 0) return true;
          const dot = (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) / (len0 * len1);
          if (dot < 0.1) return true;
        }
      }
      return false;
    };

    let alive = triCount;
    let guard = triCount * 40;

    while (alive > target && heap.size && guard-- > 0) {
      const e = heap.pop();
      const u = e.u, v = e.v;
      if (vertDead[u] || vertDead[v]) continue;
      if (version[u] !== e.vu || version[v] !== e.vv) { pushEdge(u, v); continue; }
      if (flips(u, v, e.x, e.y, e.z)) continue;

      pos[u * 3] = e.x; pos[u * 3 + 1] = e.y; pos[u * 3 + 2] = e.z;
      const ou = u * 10, ov = v * 10;
      for (let i = 0; i < 10; i++) Q[ou + i] += Q[ov + i];

      const neighbours = new Set();
      for (const t of vertTris[v]) {
        if (triDead[t]) continue;
        const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
        if (a === u || b === u || c === u) { triDead[t] = 1; alive--; continue; }
        for (let k = 0; k < 3; k++) {
          if (tris[t * 3 + k] === v) tris[t * 3 + k] = u;
          else neighbours.add(tris[t * 3 + k]);
        }
        vertTris[u].push(t);
      }
      for (const t of vertTris[u]) {
        if (triDead[t]) continue;
        for (let k = 0; k < 3; k++) {
          const w = tris[t * 3 + k];
          if (w !== u) neighbours.add(w);
        }
      }

      vertDead[v] = 1;
      vertTris[v] = [];
      version[u]++;
      for (const w of neighbours) {
        if (!vertDead[w]) { version[w]++; pushEdge(Math.min(u, w), Math.max(u, w)); }
      }
      if (onProgress && (alive & 1023) === 0) onProgress(1 - (alive - target) / (triCount - target));
    }

    // Компактизация
    const vertMap = new Int32Array(nv).fill(-1);
    const outIdx = new Uint32Array(alive * 3);
    let n = 0, vc = 0;
    for (let t = 0; t < triCount; t++) {
      if (triDead[t]) continue;
      for (let k = 0; k < 3; k++) {
        const v = tris[t * 3 + k];
        if (vertMap[v] < 0) vertMap[v] = vc++;
        outIdx[n++] = vertMap[v];
      }
    }
    const outPos = new Float32Array(vc * 3);
    for (let v = 0; v < nv; v++) {
      const m = vertMap[v];
      if (m < 0) continue;
      outPos[m * 3] = pos[v * 3]; outPos[m * 3 + 1] = pos[v * 3 + 1]; outPos[m * 3 + 2] = pos[v * 3 + 2];
    }
    return { positions: outPos, indices: outIdx.slice(0, n) };
  }

  // ── Экспорт: STL (binary) ──────────────────────────────────────────────────
  function exportSTL(positions, indices) {
    const tri = indices.length / 3;
    const buf = new ArrayBuffer(84 + tri * 50);
    const dv = new DataView(buf);
    dv.setUint32(80, tri, true);
    let o = 84;
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
      const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
      const e1x = positions[b] - ax, e1y = positions[b + 1] - ay, e1z = positions[b + 2] - az;
      const e2x = positions[c] - ax, e2y = positions[c + 1] - ay, e2z = positions[c + 2] - az;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
      dv.setFloat32(o + 12, ax, true); dv.setFloat32(o + 16, ay, true); dv.setFloat32(o + 20, az, true);
      dv.setFloat32(o + 24, positions[b], true); dv.setFloat32(o + 28, positions[b + 1], true); dv.setFloat32(o + 32, positions[b + 2], true);
      dv.setFloat32(o + 36, positions[c], true); dv.setFloat32(o + 40, positions[c + 1], true); dv.setFloat32(o + 44, positions[c + 2], true);
      o += 50;
    }
    return buf;
  }

  // ── Экспорт: OBJ ───────────────────────────────────────────────────────────
  function exportOBJ(positions, indices, name) {
    const parts = ['# Meshy Downloader\no ' + (name || 'model') + '\n'];
    let chunk = [];
    for (let i = 0; i < positions.length; i += 3) {
      chunk.push('v ' + positions[i].toFixed(6) + ' ' + positions[i + 1].toFixed(6) + ' ' + positions[i + 2].toFixed(6));
      if (chunk.length >= 4096) { parts.push(chunk.join('\n') + '\n'); chunk = []; }
    }
    if (chunk.length) { parts.push(chunk.join('\n') + '\n'); chunk = []; }
    for (let i = 0; i < indices.length; i += 3) {
      chunk.push('f ' + (indices[i] + 1) + ' ' + (indices[i + 1] + 1) + ' ' + (indices[i + 2] + 1));
      if (chunk.length >= 4096) { parts.push(chunk.join('\n') + '\n'); chunk = []; }
    }
    if (chunk.length) parts.push(chunk.join('\n') + '\n');
    return new TextEncoder().encode(parts.join('')).buffer;
  }

  // ── ZIP без сжатия (для 3MF) ───────────────────────────────────────────────
  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zipStore(files) {
    const enc = new TextEncoder();
    const entries = files.map(f => ({ name: enc.encode(f.name), data: f.data, crc: crc32(f.data) }));
    let size = 0;
    for (const e of entries) size += 30 + e.name.length + e.data.length + 46 + e.name.length;
    size += 22;

    const buf = new ArrayBuffer(size);
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let o = 0;
    const offsets = [];

    for (const e of entries) {
      offsets.push(o);
      dv.setUint32(o, 0x04034b50, true);
      dv.setUint16(o + 4, 20, true);   // version
      dv.setUint16(o + 6, 0, true);    // flags
      dv.setUint16(o + 8, 0, true);    // store
      dv.setUint16(o + 10, 0, true);   // time
      dv.setUint16(o + 12, 0x21, true); // date (1996-01-01)
      dv.setUint32(o + 14, e.crc, true);
      dv.setUint32(o + 18, e.data.length, true);
      dv.setUint32(o + 22, e.data.length, true);
      dv.setUint16(o + 26, e.name.length, true);
      dv.setUint16(o + 28, 0, true);
      o += 30;
      u8.set(e.name, o); o += e.name.length;
      u8.set(e.data, o); o += e.data.length;
    }

    const central = o;
    entries.forEach((e, i) => {
      dv.setUint32(o, 0x02014b50, true);
      dv.setUint16(o + 4, 20, true);
      dv.setUint16(o + 6, 20, true);
      dv.setUint16(o + 8, 0, true);
      dv.setUint16(o + 10, 0, true);
      dv.setUint16(o + 12, 0, true);
      dv.setUint16(o + 14, 0x21, true);
      dv.setUint32(o + 16, e.crc, true);
      dv.setUint32(o + 20, e.data.length, true);
      dv.setUint32(o + 24, e.data.length, true);
      dv.setUint16(o + 28, e.name.length, true);
      dv.setUint16(o + 30, 0, true);
      dv.setUint16(o + 32, 0, true);
      dv.setUint16(o + 34, 0, true);
      dv.setUint16(o + 36, 0, true);
      dv.setUint32(o + 38, 0, true);
      dv.setUint32(o + 42, offsets[i], true);
      o += 46;
      u8.set(e.name, o); o += e.name.length;
    });

    dv.setUint32(o, 0x06054b50, true);
    dv.setUint16(o + 8, entries.length, true);
    dv.setUint16(o + 10, entries.length, true);
    dv.setUint32(o + 12, o - central, true);
    dv.setUint32(o + 16, central, true);
    dv.setUint16(o + 20, 0, true);
    return buf;
  }

  // ── Экспорт: 3MF ───────────────────────────────────────────────────────────
  function export3MF(positions, indices, name) {
    const enc = new TextEncoder();
    const head = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<model unit="millimeter" xml:lang="en-US" '
      + 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n'
      + '<metadata name="Application">Meshy Downloader</metadata>\n'
      + '<metadata name="Title">' + String(name || 'model').replace(/[<>&"]/g, '') + '</metadata>\n'
      + '<resources><object id="1" type="model"><mesh><vertices>\n';
    const parts = [head];
    let chunk = [];
    for (let i = 0; i < positions.length; i += 3) {
      chunk.push('<vertex x="' + positions[i].toFixed(6) + '" y="' + positions[i + 1].toFixed(6)
        + '" z="' + positions[i + 2].toFixed(6) + '"/>');
      if (chunk.length >= 4096) { parts.push(chunk.join('') + '\n'); chunk = []; }
    }
    if (chunk.length) { parts.push(chunk.join('') + '\n'); chunk = []; }
    parts.push('</vertices><triangles>\n');
    for (let i = 0; i < indices.length; i += 3) {
      chunk.push('<triangle v1="' + indices[i] + '" v2="' + indices[i + 1] + '" v3="' + indices[i + 2] + '"/>');
      if (chunk.length >= 4096) { parts.push(chunk.join('') + '\n'); chunk = []; }
    }
    if (chunk.length) parts.push(chunk.join('') + '\n');
    parts.push('</triangles></mesh></object></resources>\n<build><item objectid="1"/></build>\n</model>\n');

    const contentTypes = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
      + '</Types>';
    const rels = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
      + 'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';

    return zipStore([
      { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
      { name: '_rels/.rels', data: enc.encode(rels) },
      { name: '3D/3dmodel.model', data: enc.encode(parts.join('')) }
    ]);
  }

  // ── Публичный конвейер ─────────────────────────────────────────────────────
  /** Число треугольников и вершин исходного GLB после сварки. */
  function analyze(glb) {
    const raw = glbToGeometry(glb);
    const w = weld(raw.positions, raw.indices);
    return { triangles: w.indices.length / 3, vertices: w.positions.length / 3 };
  }

  /**
   * GLB → файл выбранного формата с опциональным упрощением.
   * format: 'stl' | 'obj' | '3mf', ratio: доля оставляемых треугольников (0..1].
   */
  function convert(glb, format, ratio, name) {
    const raw = glbToGeometry(glb);
    let geo = weld(raw.positions, raw.indices);
    const origTris = geo.indices.length / 3;
    if (ratio && ratio < 0.999) geo = simplify(geo.positions, geo.indices, ratio);
    const outTris = geo.indices.length / 3;

    let buffer, mime, ext;
    if (format === 'stl') {
      buffer = exportSTL(geo.positions, geo.indices); mime = 'model/stl'; ext = 'stl';
    } else if (format === 'obj') {
      buffer = exportOBJ(geo.positions, geo.indices, name); mime = 'text/plain'; ext = 'obj';
    } else if (format === '3mf') {
      buffer = export3MF(geo.positions, geo.indices, name); mime = 'model/3mf'; ext = '3mf';
    } else {
      throw new Error('Неизвестный формат: ' + format);
    }
    return { buffer, mime, ext, origTris, outTris, vertices: geo.positions.length / 3 };
  }

  return { glbToGeometry, weld, simplify, exportSTL, exportOBJ, export3MF, analyze, convert };
}

if (typeof window !== 'undefined') {
  window.__meshyGeomFactory = __meshyGeomFactory;
  window.__meshyGeom = __meshyGeomFactory();
}
