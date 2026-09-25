// Gatinho soldado em 3ª pessoa: corpo, cabeça com orelhas, bigodes, capacete do
// time, rabo animado e a arma na mão. Também exporta as cores de pelagem.

import * as THREE from 'three';
import type { Skin, Team } from '../../shared/types.ts';
import type { WeaponId } from '../../shared/weapons.ts';
import { buildGun, type GunModel } from './Guns.ts';
import { CatBody, catAsset } from './CatAsset.ts';
import { mergeStatic } from './merge.ts';

export interface FurColors {
  base: number;
  dark: number;
  belly: number;
  eye: number;
  points: number | null; // extremidades (siamês)
  stripes: boolean;
}

export const FUR: Record<Skin, FurColors> = {
  laranja: { base: 0xe8923a, dark: 0xb8621c, belly: 0xf7e3c4, eye: 0x7ccf4a, points: null, stripes: true },
  preto: { base: 0x1f1f24, dark: 0x0e0e12, belly: 0x2a2a30, eye: 0xf2d13a, points: null, stripes: false },
  rajado: { base: 0x8d8a84, dark: 0x3d3a36, belly: 0xd8d2c6, eye: 0x9ad04a, points: null, stripes: true },
  siames: { base: 0xefe3cf, dark: 0x5a3d2b, belly: 0xf8f0e2, eye: 0x4aa3f2, points: 0x4a3222, stripes: false },
};

export const TEAM_COLOR: Record<Team, number> = { orange: 0xff8a1f, black: 0x2a2d3a };
export const TEAM_ACCENT: Record<Team, string> = { orange: '#ff9a2e', black: '#8fa3ff' };
export const TEAM_NAME: Record<Team, string> = { orange: 'Laranjas', black: 'Pretos' };

const stripeCache = new Map<Skin, THREE.Texture>();
export function furTexture(skin: Skin): THREE.Texture | null {
  const c = FUR[skin];
  if (!c.stripes) return null;
  let t = stripeCache.get(skin);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#' + c.base.toString(16).padStart(6, '0');
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#' + c.dark.toString(16).padStart(6, '0');
  for (let i = 0; i < 7; i++) {
    const y = i * 18 + 4;
    g.beginPath();
    g.moveTo(0, y);
    g.quadraticCurveTo(64, y + 10, 128, y);
    g.lineTo(128, y + 6);
    g.quadraticCurveTo(64, y + 16, 0, y + 6);
    g.fill();
  }
  t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  stripeCache.set(skin, t);
  return t;
}

export function furMaterial(skin: Skin): THREE.MeshStandardMaterial {
  const c = FUR[skin];
  const map = furTexture(skin);
  return new THREE.MeshStandardMaterial({ color: map ? 0xffffff : c.base, map, roughness: 0.95 });
}

function nameSprite(name: string, color: string): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 96;
  const g = cv.getContext('2d')!;
  g.font = 'bold 34px "Rajdhani", "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.lineJoin = 'round';
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(name, 128, 40);
  g.fillStyle = color;
  g.fillText(name, 128, 40);
  // Marcador ▼ acima da cabeça, na cor do nome
  g.beginPath();
  g.moveTo(114, 58); g.lineTo(142, 58); g.lineTo(128, 80); g.closePath();
  g.lineWidth = 5;
  g.stroke();
  g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.scale.set(0.2, 0.075, 1);
  s.renderOrder = 10;
  return s;
}

let muzzleTex: THREE.Texture | null = null;
function muzzleTexture(): THREE.Texture {
  if (muzzleTex) return muzzleTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,250,220,1)');
  grd.addColorStop(0.3, 'rgba(255,200,90,0.9)');
  grd.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grd;
  g.translate(32, 32);
  for (let i = 0; i < 5; i++) { g.rotate((Math.PI * 2) / 5); g.beginPath(); g.moveTo(0, -4); g.lineTo(32, 0); g.lineTo(0, 4); g.fill(); }
  g.beginPath(); g.arc(0, 0, 14, 0, Math.PI * 2); g.fill();
  muzzleTex = new THREE.CanvasTexture(c);
  muzzleTex.colorSpace = THREE.SRGBColorSpace;
  return muzzleTex;
}

let blobMat: THREE.MeshBasicMaterial | null = null;
const blobGeo = new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2);
/** Sombra-blob sob o gato (barata; a sombra real do sol é estática). */
function blobShadow(): THREE.Mesh {
  if (!blobMat) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    blobMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  }
  const m = new THREE.Mesh(blobGeo, blobMat);
  m.scale.set(0.75, 1, 1.2);
  m.position.y = 0.015;
  m.renderOrder = 1;
  return m;
}

export class CatModel {
  root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private arms = new THREE.Group();
  private tail: THREE.Object3D[] = [];
  private legs: THREE.Object3D[] = [];
  private guns: THREE.Group[] = [];
  private gunModels: GunModel[] = [];
  private flashes: THREE.Sprite[] = [];
  private flashT = 0;
  private kick = 0;
  private swipe = 0;
  private weapon: WeaponId = 0;
  private furMat: THREE.MeshStandardMaterial;
  label: THREE.Sprite;
  private walkPhase = 0;
  private deathT = 0;
  /** Gato animado (GLB); null = gato procedural de reserva. */
  private anim: CatBody | null = null;
  private helmet = new THREE.Group();
  private lastY = 0;
  private airT = 0;

  constructor(skin: Skin, team: Team, name: string, labelColor: string) {
    const c = FUR[skin];
    this.furMat = furMaterial(skin);
    this.label = nameSprite(name, labelColor);
    const asset = catAsset();
    if (asset) {
      this.buildAnimated(new CatBody(asset, skin), team);
      return;
    }
    const bellyMat = new THREE.MeshStandardMaterial({ color: c.belly, roughness: 1 });
    const pointMat = new THREE.MeshStandardMaterial({ color: c.points ?? c.base, roughness: 1, map: c.points ? null : furTexture(skin) });
    const pink = new THREE.MeshStandardMaterial({ color: 0xf29bb0, roughness: 0.8 });
    const teamMat = new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team], roughness: 0.6 });
    // Faixa na cor de destaque do time (lavanda para os Pretos, igual ao HUD)
    const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(TEAM_ACCENT[team]), emissive: new THREE.Color(TEAM_ACCENT[team]), emissiveIntensity: 0.25, roughness: 0.5 });
    const vest = new THREE.MeshStandardMaterial({ color: team === 'orange' ? 0x6b5a33 : 0x2c3326, roughness: 0.9 });

    // Corpo
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.28, 6, 14), this.furMat);
    torso.position.y = 0.5;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), bellyMat);
    belly.scale.set(0.9, 1.2, 0.6);
    belly.position.set(0, 0.48, -0.1);
    const vestMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.265, 0.27, 0.26, 14), vest);
    vestMesh.position.y = 0.55;
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.035, 6, 18), accentMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.42;
    this.body.add(torso, belly, vestMesh, band);

    for (const s of [-1, 1]) {
      const leg = new THREE.Group();
      const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.14, 4, 8), pointMat);
      l.position.y = -0.1;
      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), pointMat);
      paw.scale.set(1, 0.6, 1.3);
      paw.position.set(0, -0.2, -0.03);
      leg.add(l, paw);
      leg.position.set(s * 0.12, 0.24, 0);
      this.legs.push(leg);
      this.body.add(leg);
    }

    // Cabeça
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), c.points ? new THREE.MeshStandardMaterial({ color: c.base, roughness: 1 }) : this.furMat);
    skull.scale.set(1.12, 0.95, 1);
    this.head.add(skull);
    if (c.points) {
      const mask = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), pointMat);
      mask.scale.set(1.1, 0.9, 0.6);
      mask.position.set(0, -0.04, -0.15);
      this.head.add(mask);
    }
    const muzzleMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), bellyMat);
    muzzleMesh.scale.set(1.2, 0.75, 0.8);
    muzzleMesh.position.set(0, -0.07, -0.17);
    this.head.add(muzzleMesh);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), pink);
    nose.position.set(0, -0.03, -0.25);
    this.head.add(nose);
    const eyeMat = new THREE.MeshStandardMaterial({ color: c.eye, emissive: c.eye, emissiveIntensity: 0.25, roughness: 0.2 });
    const pupil = new THREE.MeshBasicMaterial({ color: 0x050505 });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), eyeMat);
      eye.position.set(s * 0.09, 0.03, -0.18);
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), pupil);
      p.scale.set(0.5, 1.4, 0.5);
      p.position.set(s * 0.09, 0.03, -0.225);
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.17, 4), pointMat);
      ear.position.set(s * 0.14, 0.2, 0);
      ear.rotation.set(0, Math.PI / 4, s * -0.35);
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.11, 4), pink);
      inner.position.set(s * 0.135, 0.19, -0.03);
      inner.rotation.set(0, Math.PI / 4, s * -0.35);
      this.head.add(eye, p, ear, inner);
      // Bigodes
      for (let k = 0; k < 3; k++) {
        const wg = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(s * 0.08, -0.06 + k * 0.02, -0.22),
          new THREE.Vector3(s * 0.32, -0.02 + k * 0.04 - 0.04, -0.2),
        ]);
        this.head.add(new THREE.Line(wg, new THREE.LineBasicMaterial({ color: 0xffffff })));
      }
    }
    // Capacete tático entre as orelhas
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), teamMat);
    helmet.scale.set(1, 0.8, 1.15);
    helmet.position.set(0, 0.1, 0.02);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 16), accentMat);
    brim.scale.set(1, 1, 1.15);
    brim.position.set(0, 0.1, 0.02);
    this.head.add(helmet, brim);
    this.head.position.y = 0.88;

    // Braços + arma
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.26, 4, 8), pointMat);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(s * 0.14, 0, -0.16);
      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), pointMat);
      paw.position.set(s * 0.1, -0.02, s < 0 ? -0.42 : -0.3);
      this.arms.add(arm, paw);
    }
    const flashMat = new THREE.SpriteMaterial({ map: muzzleTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const model = buildGun(i as WeaponId);
      const gun = model.group;
      gun.scale.setScalar(0.6);
      gun.position.set(0.02, 0.0, -0.22);
      gun.visible = false;
      const flash = new THREE.Sprite(flashMat);
      flash.scale.setScalar(0.55);
      flash.position.copy(model.muzzle.position);
      flash.visible = false;
      gun.add(flash);
      this.flashes.push(flash);
      this.gunModels.push(model);
      this.guns.push(gun);
      this.arms.add(gun);
    }
    this.arms.position.set(0, 0.62, 0);

    // Rabo: segmentos que balançam
    let parent: THREE.Object3D = this.body;
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Group();
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.045 - i * 0.003, 0.09, 4, 6), i > 3 && c.points ? pointMat : this.furMat);
      m.position.y = 0.06;
      seg.add(m);
      if (i === 0) seg.position.set(0, 0.3, 0.22);
      else seg.position.y = 0.12;
      seg.rotation.x = i === 0 ? 1.2 : -0.18;
      parent.add(seg);
      this.tail.push(seg);
      parent = seg;
    }

    this.body.add(this.head, this.arms);
    this.root.add(this.body);
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });

    this.label.position.y = 1.45;
    this.root.add(this.label);
  }

  /** Monta o gato de quatro patas: corpo animado + capacete + arma presa às costas. */
  private buildAnimated(anim: CatBody, team: Team): void {
    this.anim = anim;
    this.furMat = anim.material;
    const teamMat = new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team], roughness: 0.6 });
    const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(TEAM_ACCENT[team]), emissive: new THREE.Color(TEAM_ACCENT[team]), emissiveIntensity: 0.25, roughness: 0.5 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), teamMat);
    dome.scale.set(1, 0.75, 1.15);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.03, 16), accentMat);
    brim.scale.set(1, 1, 1.15);
    this.helmet.add(dome, brim);

    // Arma montada numa sela tática nas costas
    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.4), new THREE.MeshStandardMaterial({ color: team === 'orange' ? 0x6b5a33 : 0x2c3326, roughness: 0.9 }));
    saddle.position.y = -0.06;
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.03, 0.08), accentMat);
    strap.position.y = -0.03;
    this.arms.add(saddle, strap);
    const flashMat = new THREE.SpriteMaterial({ map: muzzleTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const model = buildGun(i as WeaponId);
      const gun = model.group;
      mergeStatic(gun, { castShadow: false }); // arma vista de fora: ~12 peças → 1 por material
      gun.scale.setScalar(0.55);
      gun.position.set(0, 0.02, -0.05);
      gun.visible = false;
      const flash = new THREE.Sprite(flashMat);
      flash.scale.setScalar(0.55);
      flash.position.copy(model.muzzle.position);
      flash.visible = false;
      gun.add(flash);
      this.flashes.push(flash);
      this.gunModels.push(model);
      this.guns.push(gun);
      this.arms.add(gun);
    }
    this.body.add(anim.object, this.helmet, this.arms);
    this.root.add(this.body);
    this.root.add(blobShadow());
    this.label.position.y = 1.15;
    this.root.add(this.label);
  }

  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  /** Ponto entre dois ossos, no espaço local do corpo. */
  private between(a: THREE.Object3D, b: THREE.Object3D | null, t: number, out: THREE.Vector3): THREE.Vector3 {
    a.getWorldPosition(out);
    if (b) out.lerp(b.getWorldPosition(this.tmp2), t);
    return this.body.worldToLocal(out);
  }

  private updateAnimated(anim: CatBody, dt: number, opts: { speed: number; pitch: number; crouch: boolean; slide: boolean; alive: boolean; inv: boolean; time: number }): void {
    const y = this.root.position.y;
    const vy = (y - this.lastY) / Math.max(dt, 1e-3);
    this.lastY = y;
    this.airT = Math.abs(vy) > 1.2 ? 0.15 : Math.max(0, this.airT - dt);

    if (!opts.alive) {
      anim.play('Death', 0.1);
      this.label.visible = false;
      this.helmet.visible = this.arms.visible = true;
    } else if (anim.playing !== 'Headbutt') {
      if (this.airT > 0) anim.play('Jump_Loop', 0.1);
      else if (opts.speed > 8.5) anim.play('Run', 0.2, Math.min(1.6, opts.speed / 10));
      else if (opts.speed > 0.8) anim.play('Walk', 0.2, Math.max(0.6, opts.speed / 4.5));
      else anim.play('Idle', 0.3);
    }
    anim.update(dt);

    // Agachar achata o gato; slide inclina
    const crouchScale = opts.crouch && opts.alive ? 0.72 : 1;
    anim.object.scale.y += (crouchScale - anim.object.scale.y) * Math.min(1, dt * 12);
    this.body.rotation.x = opts.slide ? 0.25 : 0;

    // Capacete segue o osso da cabeça; arma segue o osso do corpo
    this.root.updateMatrixWorld(true);
    if (anim.head) {
      // O osso "Head" nasce no pescoço; o capacete vai perto da ponta da cabeça
      this.between(anim.head, anim.headEnd, 0.45, this.tmp);
      this.helmet.position.copy(this.tmp).add(new THREE.Vector3(0, 0.27 * anim.object.scale.y, 0));
      this.helmet.rotation.x = opts.alive ? opts.pitch * 0.3 : 0;
    }
    if (anim.body && anim.head) {
      // Sela com a arma no meio das costas, entre quadril e pescoço
      this.between(anim.body, anim.head, 0.6, this.tmp);
      this.arms.position.set(this.tmp.x, this.tmp.y + 0.2, this.tmp.z + this.kick * 0.06);
    }
    this.kick = Math.max(0, this.kick - dt * 9);
    this.arms.rotation.x = (opts.alive ? opts.pitch : 0) + this.kick * 0.2;
    this.flashT -= dt;
    this.flashes.forEach((f, i) => { f.visible = this.flashT > 0 && i === this.weapon; });

    anim.material.emissive.setHex(opts.inv ? 0x4466ff : 0x000000);
    anim.material.emissiveIntensity = opts.inv ? 0.35 + Math.sin(opts.time * 12) * 0.25 : 0;
  }

  setWeapon(w: WeaponId): void {
    this.weapon = w;
    this.guns.forEach((g, i) => { g.visible = i === w; });
  }

  /** Disparo visto de fora: clarão no cano, braços recuam; patada = golpe. */
  fire(w: WeaponId): void {
    this.setWeapon(w);
    if (w === 3) { this.swipe = 1; this.anim?.oneShot('Headbutt'); return; }
    this.flashT = w === 0 ? 0.05 : 0.08;
    this.kick = 1;
    const f = this.flashes[w];
    f.material.rotation = Math.random() * Math.PI;
    f.scale.setScalar((w === 0 ? 0.5 : 0.8) * (0.8 + Math.random() * 0.4));
  }

  /** Posição do cano da arma atual no mundo (origem dos traçantes). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.gunModels[this.weapon].muzzle.getWorldPosition(out);
  }

  update(dt: number, opts: { speed: number; pitch: number; crouch: boolean; slide: boolean; alive: boolean; inv: boolean; time: number }): void {
    if (this.anim) { this.updateAnimated(this.anim, dt, opts); return; }
    if (!opts.alive) {
      // Tomba de lado e afunda
      this.deathT = Math.min(1, this.deathT + dt * 3);
      this.body.rotation.z = this.deathT * Math.PI / 2;
      this.body.position.y = this.deathT * 0.2;
      this.label.visible = false;
      return;
    }
    this.deathT = 0;
    this.body.rotation.z = 0;
    this.body.position.y = 0;

    this.walkPhase += dt * Math.min(opts.speed, 12) * 1.6;
    const swing = Math.min(1, opts.speed / 6) * 0.7;
    this.legs[0].rotation.x = Math.sin(this.walkPhase) * swing;
    this.legs[1].rotation.x = -Math.sin(this.walkPhase) * swing;
    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.04 * swing;

    const crouchScale = opts.crouch ? 0.66 : 1;
    this.body.scale.y += (crouchScale - this.body.scale.y) * Math.min(1, dt * 12);
    this.body.rotation.x = opts.slide ? 0.5 : 0;
    this.body.position.y = bob;

    this.head.rotation.x = opts.pitch * 0.5;
    this.kick = Math.max(0, this.kick - dt * 9);
    this.swipe = Math.max(0, this.swipe - dt * 3.5);
    this.flashT -= dt;
    this.flashes.forEach((f, i) => { f.visible = this.flashT > 0 && i === this.weapon; });
    const sw = Math.sin(this.swipe * Math.PI);
    this.arms.rotation.x = opts.pitch + this.kick * 0.25 - sw * 0.6;
    this.arms.rotation.y = sw * 0.9;
    this.arms.position.z = this.kick * 0.07 - sw * 0.1;

    for (let i = 1; i < this.tail.length; i++) {
      this.tail[i].rotation.z = Math.sin(opts.time * 3 + i * 0.6) * 0.18;
    }
    this.furMat.emissive.setHex(opts.inv ? 0x4466ff : 0x000000);
    this.furMat.emissiveIntensity = opts.inv ? 0.4 + Math.sin(opts.time * 12) * 0.3 : 0;
  }
}
