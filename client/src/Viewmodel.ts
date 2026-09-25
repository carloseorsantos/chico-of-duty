// Patinhas felpudas em 1ª pessoa segurando a arma. Renderizadas numa cena própria
// por cima do mundo (sem atravessar paredes), com bobbing, sway, recuo, ADS,
// recarga, troca de arma e a patada tática.

import * as THREE from 'three';
import type { Skin } from '../../shared/types.ts';
import { WEAPONS, type WeaponId } from '../../shared/weapons.ts';
import { FUR, furMaterial } from './CatModel.ts';
import { buildGun, type GunModel } from './Guns.ts';

const HIP = new THREE.Vector3(0.16, -0.17, -0.42);
const RIG_SCALE = 0.52;

function flashTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,230,1)');
  grd.addColorStop(0.25, 'rgba(255,210,120,0.9)');
  grd.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grd;
  g.translate(64, 64);
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath(); g.moveTo(0, -6); g.lineTo(64, 0); g.lineTo(0, 6); g.fill();
  }
  g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Chama alongada para as vistas laterais do clarão. */
function flameTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 256, 0, 0);
  grd.addColorStop(0, 'rgba(255,255,235,1)');
  grd.addColorStop(0.3, 'rgba(255,200,90,0.9)');
  grd.addColorStop(1, 'rgba(255,90,10,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(32, 0); g.quadraticCurveTo(64, 170, 36, 256); g.lineTo(28, 256); g.quadraticCurveTo(0, 170, 32, 0);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function smokeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(220,215,205,0.55)');
  grd.addColorStop(1, 'rgba(220,215,205,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface VmParticle {
  obj: THREE.Mesh | THREE.Sprite;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  max: number;
  smoke: boolean;
  active: boolean;
}

export class Viewmodel {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
  private rig = new THREE.Group(); // posição hip/ADS + animações
  private guns: GunModel[] = [];
  private rightPaw = new THREE.Group();
  private leftPaw = new THREE.Group();
  private claws: THREE.Object3D[] = [];
  private flash = new THREE.Group();
  private flashLight = new THREE.PointLight(0xffb060, 0, 1.6, 2);
  private particles: VmParticle[] = [];
  private casingGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.019, 8);
  private shellGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.028, 10);
  private brass = new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.5, roughness: 0.3, emissive: 0x3a2200 });
  private redShell = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.5 });
  private smokeTex = smokeTexture();
  private current: WeaponId = 0;
  private recoil = 0;
  private recoilRot = 0;
  private recoilYaw = 0;
  private recoilRoll = 0;
  private switchT = 0;
  private reloadT = 0;
  private reloadDur = 1;
  private meleeT = 0;
  private actionT = 0; // bomba/ferrolho após o disparo
  private bobPhase = 0;
  private swayX = 0;
  private swayY = 0;
  private flashT = 0;
  private landKick = 0;
  ads = 0;
  furMat: THREE.MeshStandardMaterial;

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xfff1dc, 0x8a6a50, 2.6));
    const key = new THREE.DirectionalLight(0xfff4e0, 2.2);
    key.position.set(-1, 2, 1);
    const rim = new THREE.DirectionalLight(0xffd6a0, 1.2);
    rim.position.set(2, 0.5, -1);
    this.scene.add(key, rim);
    this.rig.scale.setScalar(RIG_SCALE);
    this.scene.add(this.camera);
    this.camera.add(this.rig);

    for (let i = 0; i < 4; i++) {
      const g = buildGun(i as WeaponId);
      g.group.visible = false;
      this.guns.push(g);
      this.rig.add(g.group);
    }
    this.furMat = furMaterial('laranja');
    this.buildPaws('laranja');
    this.rig.add(this.rightPaw, this.leftPaw);

    // Clarão: estrela frontal + duas chamas laterais cruzadas ao longo do cano
    const additive = (map: THREE.Texture) => new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), additive(flashTexture()));
    const flameMat = additive(flameTexture());
    for (let i = 0; i < 2; i++) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.42), flameMat);
      side.rotation.x = -Math.PI / 2;
      side.position.z = -0.2;
      const holder = new THREE.Group();
      holder.rotation.z = i * Math.PI / 2;
      holder.add(side);
      this.flash.add(holder);
    }
    this.flash.add(front);
    this.flash.visible = false;
    this.rig.add(this.flash);
    this.scene.add(this.flashLight);
    this.initParticles();
    this.setWeapon(0, true);
  }

  private buildPaws(skin: Skin): void {
    this.rightPaw.clear();
    this.leftPaw.clear();
    this.claws = [];
    const c = FUR[skin];
    this.furMat = furMaterial(skin);
    const pawMat = c.points ? new THREE.MeshStandardMaterial({ color: c.points, roughness: 1 }) : this.furMat;
    const bean = new THREE.MeshStandardMaterial({ color: skin === 'preto' ? 0x3a2a30 : 0xf49ab0, roughness: 0.6 });
    const clawMat = new THREE.MeshStandardMaterial({ color: 0xfaf6ee, roughness: 0.3 });

    const makePaw = (parent: THREE.Group, withClaws: boolean) => {
      // Antebraço felpudo
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.34, 6, 12), this.furMat);
      arm.rotation.x = Math.PI / 2;
      arm.position.z = 0.22;
      // Tufinhos de pelo
      for (let i = 0; i < 5; i++) {
        const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 5), this.furMat);
        tuft.position.set(Math.sin(i * 1.3) * 0.045, Math.cos(i * 1.3) * 0.045, 0.1 + i * 0.05);
        tuft.rotation.set(Math.PI / 2 + 0.5, 0, i * 1.3);
        parent.add(tuft);
      }
      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.068, 16, 12), pawMat);
      paw.scale.set(1.05, 0.8, 1.15);
      // Almofadinhas (feijõezinhos) na palma
      const main = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), bean);
      main.scale.set(1.2, 0.5, 1);
      main.position.set(0, -0.05, 0.005);
      parent.add(arm, paw, main);
      for (let i = 0; i < 4; i++) {
        const toe = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), bean);
        toe.position.set(-0.033 + i * 0.022, -0.045, -0.04 - Math.abs(i - 1.5) * -0.006);
        parent.add(toe);
        if (withClaws) {
          const claw = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.05, 5), clawMat);
          claw.rotation.x = -Math.PI / 2;
          claw.position.set(-0.03 + i * 0.02, -0.01, -0.09);
          claw.visible = false;
          parent.add(claw);
          this.claws.push(claw);
        }
      }
    };
    makePaw(this.rightPaw, true);
    makePaw(this.leftPaw, false);
  }

  setSkin(skin: Skin): void {
    this.buildPaws(skin);
  }

  setWeapon(w: WeaponId, instant = false): void {
    this.current = w;
    this.guns.forEach((g, i) => { g.group.visible = i === w; });
    this.switchT = instant ? 0 : 1;
    this.reloadT = 0;
    const gun = this.guns[w];
    this.flash.position.copy(gun.muzzle.position);
  }

  onFire(): void {
    const w = WEAPONS[this.current];
    if (w.melee) { this.meleeT = 1; return; }
    this.recoil = Math.min(1.6, this.recoil + (this.current === 0 ? 0.45 : 1.1));
    this.recoilRot = Math.min(1.6, this.recoilRot + (this.current === 0 ? 0.4 : 1.1));
    this.recoilYaw += (Math.random() - 0.5) * (this.current === 0 ? 0.05 : 0.08);
    this.recoilRoll += (Math.random() - 0.5) * (this.current === 0 ? 0.08 : 0.15);
    this.flashT = this.current === 0 ? 0.045 : 0.07;
    this.flash.rotation.z = Math.random() * Math.PI;
    const s = this.current === 1 ? 1.5 : this.current === 2 ? 1.3 : 0.9;
    this.flash.scale.setScalar(s * (0.8 + Math.random() * 0.4));
    this.flashLight.intensity = this.current === 0 ? 4 : 7;
    if (this.current !== 0) this.actionT = 1;
    // Fuzil ejeta na hora; bomba e ferrolho ejetam na ação
    if (this.current === 0) this.ejectCasing();
    else setTimeout(() => this.ejectCasing(), this.current === 1 ? 380 : 520);
    this.puffSmoke();
  }

  private worldOf(local: THREE.Vector3): THREE.Vector3 {
    return this.guns[this.current].group.localToWorld(local.clone());
  }

  /** Pool: cápsulas e fumaça são pré-criadas e reaproveitadas (sem alocar por tiro). */
  private initParticles(): void {
    for (let i = 0; i < 18; i++) {
      const obj = new THREE.Mesh(this.casingGeo, this.brass);
      obj.visible = false;
      this.scene.add(obj);
      this.particles.push({ obj, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, max: 1, smoke: false, active: false });
    }
    for (let i = 0; i < 8; i++) {
      const obj = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
      obj.visible = false;
      this.scene.add(obj);
      this.particles.push({ obj, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, max: 1, smoke: true, active: false });
    }
  }

  private takeParticle(smoke: boolean): VmParticle {
    const pool = this.particles.filter((p) => p.smoke === smoke);
    return pool.find((p) => !p.active) ?? pool.reduce((a, b) => (a.life < b.life ? a : b));
  }

  private ejectCasing(): void {
    if (this.current === 3) return;
    const pump = this.current === 1;
    const p = this.takeParticle(false);
    const m = p.obj as THREE.Mesh;
    m.geometry = pump ? this.shellGeo : this.casingGeo;
    m.material = pump ? this.redShell : this.brass;
    m.position.copy(this.worldOf(new THREE.Vector3(0.045, 0.06, -0.12)));
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    p.vel.set(0.5 + Math.random() * 0.3, 0.5 + Math.random() * 0.3, 0.08 + Math.random() * 0.1);
    p.spin.set(Math.random() * 25, Math.random() * 25, Math.random() * 25);
    p.life = p.max = 0.7;
    p.active = true;
    m.visible = true;
  }

  private puffSmoke(): void {
    if (this.current === 3) return;
    const p = this.takeParticle(true);
    p.obj.position.copy(this.worldOf(this.guns[this.current].muzzle.position));
    p.obj.scale.setScalar(0.05);
    p.vel.set((Math.random() - 0.5) * 0.05, 0.12, -0.05);
    p.life = p.max = 0.55;
    p.active = true;
    p.obj.visible = true;
  }

  onReload(duration: number): void {
    this.reloadT = 1;
    this.reloadDur = duration;
  }

  cancelReload(): void {
    this.reloadT = 0;
  }

  onLand(): void {
    this.landKick = 1;
  }

  addSway(dx: number, dy: number): void {
    this.swayX = Math.max(-0.06, Math.min(0.06, this.swayX - dx * 0.0004));
    this.swayY = Math.max(-0.06, Math.min(0.06, this.swayY + dy * 0.0004));
  }

  /** Muzzle em coordenadas de mundo (para traçantes), dado a câmera principal. */
  muzzleWorld(mainCam: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
    // Projeta o cano do viewmodel para a tela e reconstrói num ponto do mundo
    this.guns[this.current].muzzle.getWorldPosition(out);
    out.project(this.camera);
    out.z = 0.2;
    return out.unproject(mainCam as THREE.PerspectiveCamera);
  }

  update(dt: number, s: { speed: number; onGround: boolean; adsTarget: number; sprinting: boolean; sliding: boolean; crouch: boolean; time: number }): void {
    const w = WEAPONS[this.current];
    const adsRate = this.current === 2 ? 7 : 10;
    this.ads += (s.adsTarget - this.ads) * Math.min(1, dt * adsRate);

    // Bobbing de caminhada (menor mirando)
    const moving = s.onGround ? Math.min(1, s.speed / 7) : 0;
    this.bobPhase += dt * (s.sprinting ? 13 : 9) * (moving > 0.05 ? 1 : 0);
    const bobAmp = moving * (1 - this.ads * 0.85) * (s.sprinting ? 1.8 : 1);
    const bobX = Math.sin(this.bobPhase) * 0.012 * bobAmp;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.014 * bobAmp;

    this.swayX *= Math.pow(0.001, dt);
    this.swayY *= Math.pow(0.001, dt);
    this.recoil *= Math.pow(0.0005, dt);
    this.recoilRot *= Math.pow(0.002, dt);
    this.recoilYaw *= Math.pow(0.001, dt);
    this.recoilRoll *= Math.pow(0.001, dt);
    this.landKick *= Math.pow(0.001, dt);
    this.switchT = Math.max(0, this.switchT - dt * 3.5);
    this.meleeT = Math.max(0, this.meleeT - dt / w.interval);
    this.actionT = Math.max(0, this.actionT - dt / (w.interval * 0.9));
    if (this.reloadT > 0) this.reloadT = Math.max(0, this.reloadT - dt / this.reloadDur);

    // Posição ADS: alinha a linha de mira da arma com o centro da tela
    const gun = this.guns[this.current];
    const adsPos = new THREE.Vector3(0, -gun.sightY * RIG_SCALE, this.current === 2 ? -0.24 : -0.28);
    const pos = HIP.clone().lerp(adsPos, this.ads);
    pos.x += bobX + this.swayX * (1 - this.ads * 0.7);
    pos.y += bobY + this.swayY * (1 - this.ads * 0.7) - this.landKick * 0.03;
    pos.z += this.recoil * (this.current === 0 ? 0.045 : 0.1);
    pos.y += this.recoil * 0.008;

    let rx = this.recoilRot * (this.current === 0 ? 0.06 : 0.16);
    let ry = this.recoilYaw, rz = this.recoilRoll;
    if (s.sprinting && this.ads < 0.1) { rx -= 0.25; ry += 0.6; rz += 0.2; pos.x -= 0.05; pos.y -= 0.03; }
    if (s.sliding) { rz += 0.25; pos.y -= 0.02; }

    // Troca de arma: desce e sobe
    const sw = Math.sin(this.switchT * Math.PI / 2);
    pos.y -= sw * 0.3;
    rx -= sw * 0.6;

    // Recarga: inclina a arma e mexe no carregador
    if (this.reloadT > 0) {
      const k = Math.sin((1 - this.reloadT) * Math.PI);
      rz += k * 0.7;
      rx += k * 0.2;
      pos.y -= k * 0.08;
      const mag = gun.mag;
      if (mag) mag.position.y = -0.1 - Math.sin((1 - this.reloadT) * Math.PI) * 0.25;
    } else if (gun.mag) gun.mag.position.y = -0.1;

    // Ação da bomba / ferrolho
    if (gun.pump) gun.pump.position.z = -0.45 + Math.sin(this.actionT * Math.PI) * 0.12;
    if (gun.bolt) {
      gun.bolt.rotation.z = Math.sin(this.actionT * Math.PI) * 1.2;
      gun.bolt.position.z = 0.02 + Math.max(0, Math.sin(this.actionT * Math.PI * 2 - 1)) * 0.08;
    }

    this.rig.position.copy(pos);
    this.rig.rotation.set(rx, ry, rz);

    // Patas: direita na empunhadura, esquerda no guarda-mão
    const gunVisible = this.current !== 3;
    this.guns[this.current].group.visible = gunVisible;
    if (gunVisible) {
      this.rightPaw.position.set(0.0, -0.075, 0.06);
      this.rightPaw.rotation.set(0.2, 0, 0);
      const fore = this.current === 2 ? -0.42 : this.current === 1 ? -0.45 : -0.42;
      const pumpOff = gun.pump ? gun.pump.position.z + 0.45 : 0;
      this.leftPaw.position.set(-0.02, -0.04, fore + pumpOff);
      this.leftPaw.rotation.set(0.1, 0, 0.5);
      this.leftPaw.visible = true;
      this.claws.forEach((c) => { c.visible = false; });
    } else {
      // Patada: pata direita avança com as garras de fora
      const m = Math.sin(this.meleeT * Math.PI);
      this.rightPaw.position.set(0.02 - m * 0.12, -0.02 + m * 0.06, -0.08 - m * 0.3);
      this.rightPaw.rotation.set(0.3 - m * 0.5, m * 0.4, -m * 0.6);
      this.leftPaw.position.set(-0.28, -0.08, -0.05);
      this.leftPaw.rotation.set(0.3, 0, 0.3);
      this.leftPaw.visible = true;
      this.claws.forEach((c) => { c.visible = m > 0.15; });
    }

    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.flash.position.copy(gun.muzzle.position);
    this.flashLight.position.copy(this.worldOf(gun.muzzle.position));
    this.flashLight.intensity *= Math.pow(0.0005, dt);

    // Cápsulas caindo e fumaça subindo
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dt;
      p.obj.position.addScaledVector(p.vel, dt);
      if (p.smoke) {
        const k = 1 - p.life / p.max;
        p.obj.scale.setScalar(0.05 + k * 0.22);
        ((p.obj as THREE.Sprite).material as THREE.SpriteMaterial).opacity = 0.5 * (1 - k);
      } else {
        p.vel.y -= 2.8 * dt;
        p.obj.rotation.x += p.spin.x * dt; p.obj.rotation.y += p.spin.y * dt; p.obj.rotation.z += p.spin.z * dt;
      }
      if (p.life <= 0) { p.active = false; p.obj.visible = false; }
    }

    // Com a luneta da sniper, o modelo some (overlay de luneta assume)
    this.rig.visible = !(this.current === 2 && this.ads > 0.85);
  }
}
