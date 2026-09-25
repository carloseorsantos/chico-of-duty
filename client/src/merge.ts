// Mesclagem de geometria estática por material (reduz draw calls).
// Meshes com vários materiais (ex.: caixa com uma textura por face) são separados
// por grupo de faces antes de juntar, então também entram na mesclagem.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const KEEP = ['position', 'normal', 'uv'];

function clean(g: THREE.BufferGeometry): THREE.BufferGeometry | null {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (!KEEP.includes(name)) out.deleteAttribute(name);
  out.clearGroups();
  return out.attributes.uv && out.attributes.normal ? out : null;
}

/** Recorta as faces de um grupo (geometria já sem índice). */
function slice(g: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of KEEP) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
    if (!a) continue;
    out.setAttribute(name, new THREE.BufferAttribute(a.array.slice(start * a.itemSize, (start + count) * a.itemSize), a.itemSize));
  }
  return out;
}

/**
 * Substitui os meshes estáticos de `root` por um mesh por material.
 * `skip` permite manter de fora peças que ainda serão animadas.
 */
export function mergeStatic(root: THREE.Object3D, opts: { castShadow?: boolean; skip?: (m: THREE.Mesh) => boolean } = {}): void {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const merged: THREE.Mesh[] = [];
  const add = (mat: THREE.Material, g: THREE.BufferGeometry) => {
    const list = byMat.get(mat) ?? [];
    list.push(g);
    byMat.set(mat, list);
  };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    if (opts.skip?.(m) || !m.visible) return;
    // Transforma para o espaço local de root (root pode estar posicionado)
    const toRoot = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const base = m.geometry.clone().applyMatrix4(toRoot);
    if (Array.isArray(m.material)) {
      const flat = base.index ? base.toNonIndexed() : base;
      const groups = flat.groups.length ? flat.groups : [{ start: 0, count: flat.attributes.position.count, materialIndex: 0 }];
      for (const gr of groups) {
        const mat = m.material[gr.materialIndex ?? 0];
        const piece = clean(slice(flat, gr.start, Math.min(gr.count, flat.attributes.position.count - gr.start)));
        if (mat && piece) add(mat, piece);
      }
    } else {
      const g = clean(base);
      if (!g) return;
      add(m.material, g);
    }
    merged.push(m);
  });
  for (const m of merged) m.parent?.remove(m);
  for (const [mat, geoms] of byMat) {
    const geo = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = opts.castShadow ?? true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
}
