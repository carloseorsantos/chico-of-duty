// Efeitos de tiro no mundo: traçantes que viajam, faíscas, poeira, marcas de bala
// orientadas pela superfície, pelos voando ao acertar um gato e clarões de cano.
//
// Tudo vem de pools pré-alocados: durante o tiroteio nenhum objeto, material ou
// geometria é criado (sem pico de GC nem recompilação de shader). As marcas de
// bala são um único InstancedMesh (1 draw call para todas).

import * as THREE from 'three';

function softTexture(inner: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function holeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(15,10,6,0.95)');
  grd.addColorStop(0.35, 'rgba(40,28,18,0.8)');
  grd.addColorStop(0.7, 'rgba(60,45,30,0.25)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.beginPath();
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2, r = 22 + Math.random() * 9;
    const x = 32 + Math.cos(a) * r, y = 32 + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Pool circular: reaproveita o objeto mais antigo quando esgota. */
class Pool<T extends { active: boolean }> {
  items: T[];
  private next = 0;
  constructor(size: number, make: () => T) {
    this.items = Array.from({ length: size }, make);
  }
  take(): T {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[(this.next + i) % this.items.length];
      if (!it.active) { this.next = (this.next + i + 1) % this.items.length; return it; }
    }
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    return it;
  }
}

interface Spark { active: boolean; mesh: THREE.Mesh; vel: THREE.Vector3; life: number; max: number }
interface Puff {
  active: boolean; sprite: THREE.Sprite; vel: THREE.Vector3; life: number; max: number;
  base: number; grow: number; gravity: number; alpha: number;
}
interface Tracer {
  active: boolean; mesh: THREE.Mesh; from: THREE.Vector3; dir: THREE.Vector3;
  dist: number; traveled: number; len: number;
}

const MAX_DECALS = 120;
const TRACER_SPEED = 320;
const UP_Z = new THREE.Vector3(0, 0, 1);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

export class Effects {
  private lights: { light: THREE.PointLight; life: number }[] = [];
  private sparks: Pool<Spark>;
  private puffs: Pool<Puff>;
  private tracers: Pool<Tracer>;
  private decals: THREE.InstancedMesh;
  private decalNext = 0;

  constructor(scene: THREE.Scene) {
    // Luzes de clarão reaproveitadas (criar luzes por tiro recompila shaders)
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(0xffb060, 0, 9, 2);
      scene.add(light);
      this.lights.push({ light, life: 0 });
    }

    const sparkGeo = new THREE.BoxGeometry(0.025, 0.025, 0.14);
    // Faíscas compartilham um material: somem encolhendo, não por opacidade
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd98a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.sparks = new Pool(90, () => {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { active: false, mesh, vel: new THREE.Vector3(), life: 0, max: 1 };
    });

    const dustTex = softTexture('rgba(235,220,195,0.9)', 'rgba(235,220,195,0)');
    this.puffs = new Pool(90, () => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, depthWrite: false }));
      sprite.visible = false;
      scene.add(sprite);
      return { active: false, sprite, vel: new THREE.Vector3(), life: 0, max: 1, base: 0.2, grow: 1, gravity: 0, alpha: 1 };
    });

    const tracerGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 6, 1, true);
    tracerGeo.translate(0, 0.5, 0);
    tracerGeo.rotateX(Math.PI / 2);
    this.tracers = new Pool(40, () => {
      const mesh = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffe7a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return { active: false, mesh, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, traveled: 0, len: 1 };
    });

    this.decals = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.16, 0.16),
      new THREE.MeshBasicMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
      MAX_DECALS,
    );
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    scene.add(this.decals);
  }

  /** Traçante que viaja do cano até o ponto de impacto. */
  tracer(from: THREE.Vector3, to: THREE.Vector3, color = 0xffe7a0): void {
    const dist = from.distanceTo(to);
    if (dist < 0.4) return;
    const t = this.tracers.take();
    t.active = true;
    t.from.copy(from);
    t.dir.subVectors(to, from).normalize();
    t.dist = dist;
    t.traveled = 0;
    t.len = Math.min(3.5, dist);
    t.mesh.quaternion.setFromUnitVectors(UP_Z, t.dir);
    t.mesh.position.copy(from);
    t.mesh.scale.set(1, 1, 0.01);
    (t.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    t.mesh.visible = true;
  }

  flashLight(pos: THREE.Vector3, intensity: number, distance = 9, life = 0.06): void {
    const slot = this.lights.reduce((a, b) => (a.life < b.life ? a : b));
    slot.light.position.copy(pos);
    slot.light.intensity = intensity;
    slot.light.distance = distance;
    slot.life = life;
  }

  /** Explosão de bomba de pombo: clarão, bola de fogo, fumaça, faíscas, penas e marca no chão. */
  explosion(point: THREE.Vector3): void {
    this.flashLight(tmpP.copy(point).setY(point.y + 1), 400, 26, 0.3);
    for (let i = 0; i < 18; i++) {
      const s = this.sparks.take();
      s.active = true;
      s.mesh.position.copy(point);
      s.vel.set((Math.random() - 0.5) * 16, 4 + Math.random() * 10, (Math.random() - 0.5) * 16);
      s.mesh.lookAt(tmpS.copy(point).add(s.vel));
      s.life = s.max = 0.3 + Math.random() * 0.3;
      s.mesh.scale.setScalar(1.6);
      s.mesh.visible = true;
    }
    for (let i = 0; i < 7; i++) {
      this.puff(tmpS.copy(point).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.8)),
        new THREE.Vector3((Math.random() - 0.5) * 3, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 3),
        { life: 0.45, base: 0.9 + Math.random() * 0.5, grow: 2.5, gravity: -1, alpha: 0.95, color: i % 2 ? 0xffb040 : 0xff6a20 });
    }
    for (let i = 0; i < 9; i++) {
      this.puff(tmpS.copy(point).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.3 + Math.random(), (Math.random() - 0.5) * 1.5)),
        new THREE.Vector3((Math.random() - 0.5) * 2.5, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 2.5),
        { life: 1.8 + Math.random() * 0.6, base: 1.0 + Math.random() * 0.6, grow: 3.2, gravity: -0.6, alpha: 0.75, color: 0x5a5550 });
    }
    // Penas: o bando não economiza nas plumas
    for (let i = 0; i < 10; i++) {
      this.puff(tmpS.copy(point).setY(point.y + 1.2), new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6), {
        life: 1.6, base: 0.14, grow: 0.3, gravity: 1.5, alpha: 1, color: i % 3 ? 0xd8dde3 : 0x7d8796,
      });
    }
    this.decal(point, tmpP.set(0, 1, 0), 9);
  }

  private puff(pos: THREE.Vector3, vel: THREE.Vector3, o: { life: number; base: number; grow: number; gravity: number; alpha: number; color: number }): void {
    const p = this.puffs.take();
    p.active = true;
    p.sprite.position.copy(pos);
    p.vel.copy(vel);
    p.life = p.max = o.life;
    p.base = o.base; p.grow = o.grow; p.gravity = o.gravity; p.alpha = o.alpha;
    p.sprite.scale.setScalar(o.base);
    p.sprite.material.color.setHex(o.color);
    p.sprite.material.opacity = o.alpha;
    p.sprite.visible = true;
  }

  /** Impacto numa superfície: faíscas, poeira e marca de bala. */
  impact(point: THREE.Vector3, normal: THREE.Vector3 | null, strength = 1): void {
    const n = normal ?? tmpP.set(0, 1, 0);
    for (let i = 0; i < 4 + strength * 3; i++) {
      const s = this.sparks.take();
      s.active = true;
      s.mesh.position.copy(point);
      s.vel.copy(n).multiplyScalar(3 + Math.random() * 4)
        .add(tmpS.set((Math.random() - 0.5) * 5, Math.random() * 3, (Math.random() - 0.5) * 5));
      s.mesh.lookAt(tmpS.copy(point).add(s.vel));
      s.life = s.max = 0.18 + Math.random() * 0.12;
      s.mesh.scale.setScalar(1);
      s.mesh.visible = true;
    }
    for (let i = 0; i < 2 + strength; i++) {
      const base = 0.25 + Math.random() * 0.2;
      this.puff(
        tmpS.copy(point).addScaledVector(n, 0.05),
        new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.6, (Math.random() - 0.5)).addScaledVector(n, 0.8 + Math.random()),
        { life: 0.7, base, grow: 2.2, gravity: -0.5, alpha: 0.7, color: 0xffffff },
      );
    }
    this.decal(point, n);
  }

  /** Acerto num gato: tufos de pelo voando (sem sangue, é um jogo fofo). */
  furHit(point: THREE.Vector3, color: number): void {
    for (let i = 0; i < 7; i++) {
      this.puff(point, new THREE.Vector3((Math.random() - 0.5) * 4, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 4), {
        life: 0.8, base: 0.1 + Math.random() * 0.08, grow: 0.6, gravity: 3, alpha: 0.95, color: i % 2 ? color : 0xffffff,
      });
    }
  }

  private decal(point: THREE.Vector3, n: THREE.Vector3, scale = 1): void {
    tmpQ.setFromUnitVectors(UP_Z, n);
    tmpP.copy(point).addScaledVector(n, 0.012);
    tmpQ.multiply(new THREE.Quaternion().setFromAxisAngle(UP_Z, Math.random() * Math.PI * 2));
    const sc = (0.8 + Math.random() * 0.5) * scale;
    tmpM.compose(tmpP, tmpQ, tmpS.set(sc, sc, sc));
    this.decals.setMatrixAt(this.decalNext, tmpM);
    this.decalNext = (this.decalNext + 1) % MAX_DECALS;
    this.decals.count = Math.min(MAX_DECALS, this.decals.count + 1);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /** Apaga as marcas de bala (troca de mapa). */
  clearDecals(): void {
    this.decals.count = 0;
    this.decalNext = 0;
  }

  update(dt: number): void {
    for (const t of this.tracers.items) {
      if (!t.active) continue;
      t.traveled += TRACER_SPEED * dt;
      const head = Math.min(t.traveled, t.dist);
      const tail = Math.max(0, head - t.len);
      t.mesh.position.copy(t.from).addScaledVector(t.dir, tail);
      t.mesh.scale.z = Math.max(0.01, head - tail);
      if (t.traveled - t.len >= t.dist) { t.active = false; t.mesh.visible = false; }
    }
    for (const s of this.sparks.items) {
      if (!s.active) continue;
      s.life -= dt;
      s.vel.y -= 12 * dt;
      s.vel.multiplyScalar(Math.pow(0.2, dt));
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.scale.setScalar(Math.max(0.01, s.life / s.max));
      if (s.life <= 0) { s.active = false; s.mesh.visible = false; }
    }
    for (const p of this.puffs.items) {
      if (!p.active) continue;
      p.life -= dt;
      const k = Math.max(0, p.life / p.max);
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.pow(0.2, dt));
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(p.base * (1 + (1 - k) * p.grow));
      p.sprite.material.opacity = p.alpha * k;
      if (p.life <= 0) { p.active = false; p.sprite.visible = false; }
    }
    for (const l of this.lights) {
      if (l.life > 0) {
        l.life -= dt;
        l.light.intensity = l.life <= 0 ? 0 : l.light.intensity * 0.6;
      }
    }
  }
}
