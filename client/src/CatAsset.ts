// Carrega o gato animado (Quaternius "Cat", CC0, via poly.pizza) e gera uma textura
// por pelagem, recolorindo os 4 quadradinhos do atlas que a malha usa.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Skin } from '../../shared/types.ts';

// Quadradinhos do atlas (32×32 px, linha y=416) usados pela malha do gato
const SWATCHES = {
  base: [192, 416], // pelo principal (cinza)
  light: [224, 416], // barriga e focinho
  dark: [288, 416], // listras, olhos, patas
  pink: [256, 416], // nariz e orelhas
} as const;

const PALETTE: Record<Skin, { base: string; light: string; dark: string; pink: string }> = {
  laranja: { base: '#e8923a', light: '#f7e3c4', dark: '#9c5214', pink: '#f29bb0' },
  preto: { base: '#26262c', light: '#3a3a44', dark: '#101014', pink: '#6a4a52' },
  rajado: { base: '#8d8a84', light: '#d8d2c6', dark: '#3d3a36', pink: '#e8a0ae' },
  siames: { base: '#efe3cf', light: '#f8f0e2', dark: '#4a3222', pink: '#d99aa6' },
};

export const CAT_HEIGHT = 1.0; // altura alvo em pé (coincide com a hitbox)

interface CatAsset {
  gltf: GLTF;
  textures: Record<Skin, THREE.Texture>;
  scale: number;
  facingFix: number; // rotação Y para o gato olhar para -Z
}

let asset: CatAsset | null = null;

export function catAsset(): CatAsset | null {
  return asset;
}

export async function loadCatAsset(): Promise<void> {
  const gltf = await new GLTFLoader().loadAsync('/models/cat.glb');
  const mesh = findSkinned(gltf.scene)!;
  const srcMat = mesh.material as THREE.MeshStandardMaterial;
  const img = srcMat.map!.image as HTMLImageElement | ImageBitmap;

  const textures = {} as Record<Skin, THREE.Texture>;
  for (const skin of Object.keys(PALETTE) as Skin[]) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img as CanvasImageSource, 0, 0);
    const k = img.width / 512;
    for (const [part, [x, y]] of Object.entries(SWATCHES)) {
      g.fillStyle = PALETTE[skin][part as keyof typeof SWATCHES];
      g.fillRect(x * k, y * k, 32 * k, 32 * k);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false; // glTF não inverte V
    t.magFilter = THREE.NearestFilter;
    textures[skin] = t;
  }

  // Mede o gato na pose de repouso para escalar e orientar
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const scale = CAT_HEIGHT / size.y;
  const head = gltf.scene.getObjectByName('Head');
  const center = box.getCenter(new THREE.Vector3());
  const headPos = head ? head.getWorldPosition(new THREE.Vector3()) : center.clone().setZ(center.z - 1);
  const facingFix = headPos.z > center.z ? Math.PI : 0; // cabeça precisa apontar para -Z
  asset = { gltf, textures, scale, facingFix };
}

function findSkinned(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((o) => { if (!found && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh; });
  return found;
}

export type CatAnim = 'Idle' | 'Walk' | 'Run' | 'Jump_Loop' | 'Death' | 'Headbutt';

/** Instância animada de um gato com a pelagem escolhida. */
export class CatBody {
  object: THREE.Group;
  head: THREE.Object3D | null;
  headEnd: THREE.Object3D | null;
  body: THREE.Object3D | null;
  material: THREE.MeshStandardMaterial;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: string | null = null;

  constructor(a: CatAsset, skin: Skin) {
    const inner = SkeletonUtils.clone(a.gltf.scene) as THREE.Group;
    inner.scale.multiplyScalar(a.scale);
    inner.rotation.y = a.facingFix;
    this.object = new THREE.Group();
    this.object.add(inner);
    this.material = new THREE.MeshStandardMaterial({ map: a.textures[skin], roughness: 0.9 });
    inner.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) { m.material = this.material; m.frustumCulled = false; }
    });
    this.head = inner.getObjectByName('Head') ?? null;
    this.headEnd = inner.getObjectByName('Head_end') ?? null;
    this.body = inner.getObjectByName('Body') ?? null;
    this.mixer = new THREE.AnimationMixer(inner);
    for (const clip of a.gltf.animations) {
      const name = clip.name.split('|').pop()!;
      this.actions.set(name, this.mixer.clipAction(clip));
    }
    for (const n of ['Death', 'Headbutt']) {
      const act = this.actions.get(n);
      if (act) { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; }
    }
    this.play('Idle');
  }

  play(name: CatAnim, fade = 0.2, timeScale = 1): void {
    const next = this.actions.get(name);
    if (!next) return;
    next.timeScale = timeScale;
    if (this.current === name) return;
    const prev = this.current ? this.actions.get(this.current) : null;
    next.reset().play();
    if (prev) prev.crossFadeTo(next, fade, false);
    this.current = name;
  }

  /** Ação única por cima da atual (ex.: cabeçada da patada), depois volta. */
  oneShot(name: CatAnim): void {
    const act = this.actions.get(name);
    if (!act) return;
    const back = this.current;
    this.current = null;
    this.play(name, 0.08);
    setTimeout(() => { if (this.current === name && back) this.play(back as CatAnim, 0.15); }, 450);
  }

  get playing(): string | null {
    return this.current;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }
}
