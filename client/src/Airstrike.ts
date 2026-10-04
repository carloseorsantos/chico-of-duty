// Bombardeio de Pombos no cliente: o bando cruzando o mapa, as bombas caindo, as
// áreas de perigo no chão e as explosões. O dano é todo do servidor; aqui só
// sincronizamos o espetáculo com os atrasos que ele mandou.

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MAP } from '../../shared/map.ts';
import type { ServerMsg, Team } from '../../shared/types.ts';
import { AIRSTRIKE } from '../../shared/weapons.ts';
import { audio } from './Audio.ts';
import type { Effects } from './Effects.ts';

const FALL = 0.8; // s de queda de cada bomba
const SPEED = AIRSTRIKE.spacing / (AIRSTRIKE.stepMs / 1000); // o bando passa sobre uma bomba a cada stepMs
const LEAD = 40; // unidades antes/depois da linha de bombas em que o bando aparece/some
const PIGEON_LEN = 1.6;
const FORMATION: [number, number][] = [[0, 0], [-1.6, -1.3], [-1.6, 1.3], [-3.2, -2.6], [-3.2, 2.6]]; // [trás, lado]

let pigeon: { gltf: GLTF; scale: number; clip: THREE.AnimationClip | null } | null = null;

/** Pombo animado (GLB opcional); sem ele o bando usa pombos procedurais. */
export async function loadPigeon(): Promise<void> {
  const gltf = await new GLTFLoader().loadAsync('/models/pigeon.glb');
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const scale = PIGEON_LEN / Math.max(size.x, size.z, 0.001);
  const pick = (k: string) => gltf.animations.find((a) => a.name.toLowerCase().includes(k));
  pigeon = { gltf, scale, clip: pick('jump') ?? pick('walk') ?? gltf.animations[0] ?? null };
}

function proceduralPigeon(): { root: THREE.Object3D; wings: THREE.Object3D[] } {
  const root = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0x8a93a0, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x4f5866, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), grey);
  body.scale.set(1, 0.8, 1.8);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), dark);
  head.position.set(0, 0.2, 0.6);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 6), new THREE.MeshStandardMaterial({ color: 0xe0a040 }));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.18, 0.82);
  root.add(body, head, beak);
  const wings: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.25, 0.1, 0);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.5), dark);
    wing.position.x = side * 0.45;
    pivot.add(wing);
    pivot.userData.side = side;
    root.add(pivot);
    wings.push(pivot);
  }
  return { root, wings };
}

interface Bomb {
  x: number; y: number; z: number;
  dropAt: number; boomAt: number; // ms (relógio local)
  mesh: THREE.Mesh | null;
  ring: THREE.Group;
  done: boolean;
}

interface Strike {
  team: Team;
  bombs: Bomb[];
  flock: THREE.Group;
  mixers: THREE.AnimationMixer[];
  wings: THREE.Object3D[];
  dir: THREE.Vector3;
  origin: THREE.Vector3; // posição do líder no instante t0
  t0: number;
  endAt: number;
  cooed: boolean;
}

export class AirstrikeFx {
  private strikes: Strike[] = [];
  private scene: THREE.Scene;
  private fx: Effects;
  private onBoom: (pos: THREE.Vector3) => void;
  private bombGeo = new THREE.SphereGeometry(0.22, 10, 8);
  private bombMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.4, metalness: 0.5 });
  private ringGeo = new THREE.RingGeometry(AIRSTRIKE.radius * 0.92, AIRSTRIKE.radius, 40);
  private fillGeo = new THREE.CircleGeometry(AIRSTRIKE.radius * 0.92, 40);

  constructor(scene: THREE.Scene, fx: Effects, onBoom: (pos: THREE.Vector3) => void) {
    this.scene = scene;
    this.fx = fx;
    this.onBoom = onBoom;
  }

  start(msg: Extract<ServerMsg, { t: 'airstrike' }>, myTeam: Team, now = performance.now()): void {
    if (!msg.points.length) return;
    const dir = new THREE.Vector3(msg.dir[0], 0, msg.dir[1]).normalize();
    const height = Math.min(12, MAP.room.height - 4);
    const first = msg.points[0];
    // O líder passa sobre a bomba i no instante (atraso_i − FALL)
    const t0 = now + first[3] - FALL * 1000;
    const origin = new THREE.Vector3(first[0], height, first[2]);
    const ally = msg.team === myTeam;
    const color = ally ? 0x5cff7a : 0xff3b3b;

    const bombs: Bomb[] = msg.points.map(([x, y, z, delay]) => {
      const ring = new THREE.Group();
      const edge = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
      const fill = new THREE.Mesh(this.fillGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
      ring.add(edge, fill);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, y + 0.04, z);
      ring.renderOrder = 2;
      this.scene.add(ring);
      return { x, y, z, dropAt: now + delay - FALL * 1000, boomAt: now + delay, mesh: null, ring, done: false };
    });

    const flock = new THREE.Group();
    const mixers: THREE.AnimationMixer[] = [];
    const wings: THREE.Object3D[] = [];
    for (const [back, side] of FORMATION) {
      let bird: THREE.Object3D;
      if (pigeon) {
        bird = SkeletonUtils.clone(pigeon.gltf.scene);
        bird.scale.setScalar(pigeon.scale);
        if (pigeon.clip) {
          const mixer = new THREE.AnimationMixer(bird);
          const act = mixer.clipAction(pigeon.clip);
          act.timeScale = 2.2;
          act.time = Math.random() * pigeon.clip.duration;
          act.play();
          mixers.push(mixer);
        }
      } else {
        const p = proceduralPigeon();
        bird = p.root;
        wings.push(...p.wings);
      }
      const holder = new THREE.Group();
      holder.add(bird);
      holder.position.set(side, Math.random() * 0.6, back);
      holder.userData.bob = Math.random() * Math.PI * 2;
      flock.add(holder);
    }
    flock.rotation.y = Math.atan2(dir.x, dir.z); // +Z local = direção de voo
    flock.traverse((o) => { o.castShadow = true; o.frustumCulled = false; });
    flock.visible = false;
    this.scene.add(flock);

    const span = Math.abs(msg.points[msg.points.length - 1][3] - first[3]);
    this.strikes.push({
      team: msg.team, bombs, flock, mixers, wings, dir, origin, t0,
      endAt: t0 + span + ((LEAD * 2) / SPEED) * 1000 + 1500, cooed: false,
    });
  }

  update(dt: number, now = performance.now()): void {
    for (const s of this.strikes) {
      // Bando: entra LEAD unidades antes e sai LEAD depois
      const tRel = (now - s.t0) / 1000;
      const along = tRel * SPEED;
      const fromStart = along + LEAD;
      s.flock.visible = fromStart > 0 && now < s.endAt - 1500;
      s.flock.position.copy(s.origin).addScaledVector(s.dir, along);
      if (s.flock.visible && !s.cooed && fromStart > LEAD * 0.4) {
        s.cooed = true;
        audio.play('flap', { pos: s.flock.position, volume: 1 });
        audio.play('coo', { pos: s.flock.position, volume: 1 });
      }
      for (const h of s.flock.children) {
        h.userData.bob += dt * 6;
        h.position.y = Math.sin(h.userData.bob) * 0.25;
      }
      for (const m of s.mixers) m.update(dt);
      for (const w of s.wings) w.rotation.z = Math.sin(now / 55) * 0.8 * w.userData.side;

      for (const b of s.bombs) {
        if (b.done) continue;
        const pulse = 0.6 + 0.4 * Math.sin(now / 90);
        for (const c of b.ring.children) {
          const mat = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
          mat.opacity = (mat.userData.base ??= mat.opacity) * pulse;
        }
        if (now >= b.dropAt && !b.mesh) {
          b.mesh = new THREE.Mesh(this.bombGeo, this.bombMat);
          b.mesh.castShadow = true;
          this.scene.add(b.mesh);
          audio.play('whistle', { pos: { x: b.x, y: b.y + 6, z: b.z }, volume: 0.9 });
        }
        if (b.mesh) {
          const k = Math.min(1, (now - b.dropAt) / (b.boomAt - b.dropAt));
          const top = s.origin.y - 0.4;
          b.mesh.position.set(b.x, top + (b.y - top) * k * k, b.z);
        }
        if (now >= b.boomAt) {
          b.done = true;
          if (b.mesh) this.scene.remove(b.mesh);
          this.removeRing(b.ring);
          const pos = new THREE.Vector3(b.x, b.y, b.z);
          this.fx.explosion(pos);
          audio.play('boom', { pos, volume: 1.3 });
          this.onBoom(pos);
        }
      }
    }
    for (const s of this.strikes.filter((x) => now >= x.endAt && x.bombs.every((b) => b.done))) this.dispose(s);
  }

  /** Remove tudo (troca de mapa / nova partida). */
  clear(): void {
    for (const s of [...this.strikes]) this.dispose(s);
  }

  private removeRing(ring: THREE.Group): void {
    this.scene.remove(ring);
    for (const c of ring.children) ((c as THREE.Mesh).material as THREE.Material).dispose();
  }

  private dispose(s: Strike): void {
    this.scene.remove(s.flock);
    for (const b of s.bombs) {
      if (b.mesh) this.scene.remove(b.mesh);
      if (!b.done) this.removeRing(b.ring);
    }
    this.strikes.splice(this.strikes.indexOf(s), 1);
  }
}
