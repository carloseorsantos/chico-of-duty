// Modelos procedurais das armas (usados na 1ª pessoa e nos gatos em 3ª pessoa).
// Todas apontam para -Z; a origem fica na empunhadura.

import * as THREE from 'three';
import type { WeaponId } from '../../shared/weapons.ts';

const metal = new THREE.MeshStandardMaterial({ color: 0x5a6068, metalness: 0.15, roughness: 0.45 });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x3c4148, metalness: 0.1, roughness: 0.55 });
const tan = new THREE.MeshStandardMaterial({ color: 0xa8905f, roughness: 0.7 });
const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.55 });
const glass = new THREE.MeshStandardMaterial({ color: 0x5fb4ff, metalness: 0.0, roughness: 0.05, emissive: 0x0a2a44 });
const red = new THREE.MeshBasicMaterial({ color: 0xff3355 });

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function cyl(r: number, len: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 12): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

export interface GunModel {
  group: THREE.Group;
  muzzle: THREE.Object3D; // ponto do cano (flash / traçante)
  sightY: number; // altura da linha de mira em relação à origem
  pump?: THREE.Object3D;
  bolt?: THREE.Object3D;
  mag?: THREE.Object3D;
}

export function buildGun(id: WeaponId): GunModel {
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  let sightY = 0.1;
  const out: GunModel = { group: g, muzzle, sightY };

  if (id === 0) {
    // Meow-4A1: fuzil compacto com miras em forma de orelhinhas
    g.add(box(0.07, 0.09, 0.42, darkMetal, 0, 0.03, -0.12));
    g.add(box(0.075, 0.07, 0.3, tan, 0, 0.02, -0.45)); // guarda-mão
    g.add(cyl(0.016, 0.28, metal, 0, 0.035, -0.72));
    g.add(box(0.05, 0.1, 0.05, tan, 0, -0.06, 0.02)); // empunhadura
    const mag = box(0.05, 0.16, 0.07, darkMetal, 0, -0.1, -0.18);
    mag.rotation.x = 0.2;
    g.add(mag);
    out.mag = mag;
    g.add(box(0.05, 0.08, 0.22, tan, 0, 0.0, 0.2)); // coronha
    g.add(box(0.03, 0.02, 0.3, metal, 0, 0.085, -0.15)); // trilho
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.045, 4), metal);
      ear.position.set(s * 0.014, 0.115, -0.26);
      g.add(ear);
    }
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 6), red);
    dot.position.set(0, 0.105, -0.25);
    g.add(dot);
    muzzle.position.set(0, 0.035, -0.87);
    sightY = 0.105;
  } else if (id === 1) {
    // Purr-Pump: escopeta de bomba com coronha de madeira
    g.add(box(0.08, 0.09, 0.3, darkMetal, 0, 0.03, -0.1));
    g.add(cyl(0.024, 0.62, metal, 0, 0.05, -0.55));
    g.add(cyl(0.019, 0.5, darkMetal, 0, 0.0, -0.5));
    const pump = box(0.075, 0.065, 0.2, wood, 0, 0.005, -0.45);
    g.add(pump);
    out.pump = pump;
    g.add(box(0.05, 0.1, 0.05, wood, 0, -0.06, 0.03));
    const stock = box(0.055, 0.1, 0.3, wood, 0, -0.01, 0.22);
    stock.rotation.x = -0.08;
    g.add(stock);
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffe28a }));
    bead.position.set(0, 0.078, -0.84);
    g.add(bead);
    muzzle.position.set(0, 0.05, -0.87);
    sightY = 0.078;
  } else if (id === 2) {
    // Cat-98k: fuzil de ferrolho com luneta
    g.add(box(0.06, 0.08, 0.95, wood, 0, 0.0, -0.3));
    g.add(cyl(0.015, 0.45, metal, 0, 0.035, -0.95));
    g.add(box(0.055, 0.12, 0.28, wood, 0, -0.03, 0.28));
    g.add(box(0.045, 0.06, 0.25, darkMetal, 0, 0.055, -0.12));
    g.add(cyl(0.028, 0.34, darkMetal, 0, 0.13, -0.12, 16)); // luneta
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 16), glass);
    lens.position.set(0, 0.13, -0.291);
    lens.rotation.y = Math.PI;
    g.add(lens);
    g.add(box(0.02, 0.04, 0.03, darkMetal, 0, 0.09, -0.02));
    g.add(box(0.02, 0.04, 0.03, darkMetal, 0, 0.09, -0.22));
    const bolt = new THREE.Group();
    const handle = cyl(0.008, 0.08, metal, 0.05, 0.05, 0);
    handle.rotation.set(0, 0, Math.PI / 2);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), metal);
    knob.position.set(0.09, 0.05, 0);
    bolt.add(handle, knob);
    bolt.position.z = 0.02;
    g.add(bolt);
    out.bolt = bolt;
    muzzle.position.set(0, 0.035, -1.18);
    sightY = 0.13;
  } else {
    // Patada: sem arma (a pata faz o trabalho)
    muzzle.position.set(0, 0, -0.4);
  }
  g.add(muzzle);
  out.sightY = sightY;
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return out;
}
