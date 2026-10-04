// Armas no cliente: cadência, carregador, recarga, ADS, troca, recuo e patada.
// O servidor valida tudo de novo; aqui geramos o feedback imediato.

import * as THREE from 'three';
import { burstReset, RIFLE_SPRAY_YAW, spreadFor, WEAPONS, type WeaponDef, type WeaponId } from '../../shared/weapons.ts';
import { audio, WEAPON_SFX } from './Audio.ts';
import type { Input } from './Input.ts';
import type { Network } from './Network.ts';
import type { Viewmodel } from './Viewmodel.ts';

export interface FireEvent {
  weapon: WeaponDef;
  dirs: THREE.Vector3[];
}

export class WeaponManager {
  current: WeaponId = 0;
  ammo: number[] = WEAPONS.map((w) => w.mag);
  reloadUntil = 0;
  private lastShot = 0;
  private switchUntil = 0;
  private net: Network;
  private vm: Viewmodel;
  private input: Input;
  private lastPrimary: WeaponId = 0;
  /** Tiros seguidos na rajada atual (bloom e padrão de recuo). */
  burst = 0;
  private lastSprint = 0;
  static readonly SPRINT_OUT_MS = 150;

  constructor(net: Network, vm: Viewmodel, input: Input) {
    this.net = net;
    this.vm = vm;
    this.input = input;
  }

  get def(): WeaponDef {
    return WEAPONS[this.current];
  }

  get reloading(): boolean {
    return performance.now() < this.reloadUntil;
  }

  reset(): void {
    this.ammo = WEAPONS.map((w) => w.mag);
    this.reloadUntil = 0;
    this.select(0, true);
  }

  select(w: WeaponId, silent = false): void {
    if (w === this.current && !silent) return;
    if (w !== 3) this.lastPrimary = w;
    this.current = w;
    this.reloadUntil = 0;
    this.switchUntil = performance.now() + (silent ? 0 : 300);
    this.vm.setWeapon(w, silent);
    this.net.send({ t: 'switch', w });
    if (!silent) audio.play('switch');
  }

  reload(): void {
    const d = this.def;
    if (d.melee || this.reloading || this.ammo[this.current] >= d.mag) return;
    this.reloadUntil = performance.now() + d.reload * 1000;
    this.vm.onReload(d.reload);
    audio.play('reload');
    this.net.send({ t: 'reload', w: this.current });
  }

  /** Processa as teclas de arma e o gatilho. Retorna o disparo feito neste frame. */
  /** Dispersão atual (a mira do HUD usa o mesmo valor que o servidor). */
  currentSpread(ads: boolean, speed: number, onGround: boolean): number {
    const now = performance.now();
    const burst = now - this.lastShot > burstReset(this.def) * 1000 ? 0 : this.burst + 1;
    return spreadFor(this.def, { ads, speed, onGround, burst });
  }

  update(camera: THREE.Camera, canAct: boolean, speed: number, onGround: boolean, sprinting: boolean): FireEvent | null {
    const now = performance.now();
    const inp = this.input;
    // Sprint-out: ao sair da corrida a arma leva um instante para voltar à posição
    if (sprinting) this.lastSprint = now;

    // Recarga concluída
    if (this.reloadUntil && now >= this.reloadUntil) {
      this.ammo[this.current] = this.def.mag;
      this.reloadUntil = 0;
    }
    if (!canAct) { inp.clicks = 0; return null; }

    if (inp.consume('Digit1')) this.select(0);
    if (inp.consume('Digit2')) this.select(1);
    if (inp.consume('Digit3')) this.select(2);
    const wheel = inp.consumeWheel();
    if (wheel) this.select((((this.current + wheel) % 3) + 3) % 3 as WeaponId);
    if (inp.consume('KeyR')) this.reload();

    // Patada rápida (V / botão lateral) sem trocar de arma
    let quickMelee = false;
    if (inp.consume('KeyV') || inp.consume('Melee')) {
      if (this.current !== 3) { this.select(3, true); quickMelee = true; }
    }

    const d = this.def;
    const clicked = inp.clicks > 0;
    const wantFire = quickMelee || clicked || (inp.mouseDown && d.auto);
    const sprintBlock = now - this.lastSprint < WeaponManager.SPRINT_OUT_MS && !d.melee;
    if (!wantFire || sprintBlock || now < this.switchUntil || now - this.lastShot < d.interval * 1000) {
      // Clique durante a cadência de uma arma semi-automática é descartado
      if (clicked && !d.auto && now - this.lastShot < d.interval * 1000) inp.clicks = 0;
      return null;
    }
    inp.clicks = 0;

    if (!d.melee) {
      if (this.reloading) return null;
      if (this.ammo[this.current] <= 0) {
        audio.play('dry');
        this.reload();
        return null;
      }
      this.ammo[this.current]--;
    }
    this.burst = now - this.lastShot > burstReset(d) * 1000 ? 0 : this.burst + 1;
    this.lastShot = now;

    // Direção central + dispersão (cosmética; o servidor sorteia a sua com a mesma fórmula)
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const ads = this.vm.ads > 0.6;
    const spread = spreadFor(d, { ads, speed, onGround, burst: this.burst });
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const dirs: THREE.Vector3[] = [];
    for (let i = 0; i < d.pellets; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      dirs.push(fwd.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize());
    }

    this.net.send({ t: 'shoot', w: this.current, dx: fwd.x, dy: fwd.y, dz: fwd.z, ads, rt: this.net.renderTime() });
    this.vm.onFire();
    const sfx = WEAPON_SFX[this.current];
    if (sfx) audio.play(sfx, { volume: this.current === 3 ? 0.8 : 0.9 });
    if (this.current === 1) audio.play('rack');
    if (this.current === 2) audio.play('bolt');
    // Recuo: o fuzil segue um padrão fixo (dá para aprender a compensar, como no CS);
    // as outras armas têm um coice vertical com pequena variação
    if (d.id === 0) {
      const yaw = RIFLE_SPRAY_YAW[Math.min(this.burst, RIFLE_SPRAY_YAW.length - 1)];
      const climb = this.burst < 8 ? 1 : 0.35; // sobe no começo e depois estabiliza
      inp.kick(d.recoil * climb * (ads ? 0.6 : 1), yaw * (ads ? 0.6 : 1));
    } else {
      inp.kick(d.recoil * (ads ? 0.6 : 1) * (0.9 + Math.random() * 0.2), (Math.random() - 0.5) * d.recoil * 0.2);
    }

    const ev: FireEvent = { weapon: d, dirs };
    if (quickMelee) {
      // Volta para a arma anterior depois da patada
      const back = this.lastPrimary;
      setTimeout(() => { if (this.current === 3) this.select(back, true); }, d.interval * 1000);
    }
    if (!d.melee && this.ammo[this.current] === 0) setTimeout(() => this.reload(), 250);
    return ev;
  }
}
