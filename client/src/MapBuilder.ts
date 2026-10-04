// Monta os mapas em escala de gato com texturas procedurais em canvas: a "Sala de
// Estar Proibida" (tacos de madeira, tecido, papelão "Prime Meow"...) e o Shipment
// (convés de aço, contêineres corrugados, caixotes, mar e céu aberto).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeStatic } from './merge.ts';
import { MAP, type Box, type MapDef, type Room } from '../../shared/map.ts';

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, alpha: number): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

const woodFloor = () => canvasTex(512, 512, (g) => {
  const tones = ['#9c6b3f', '#a8764a', '#8e5f36', '#b07f52', '#966640'];
  const pw = 64;
  for (let row = 0; row < 8; row++) {
    const off = (row % 2) * 128;
    for (let col = -1; col < 3; col++) {
      g.fillStyle = tones[(row * 3 + col + 5) % tones.length];
      const x = col * 256 + off;
      g.fillRect(x, row * pw, 256, pw);
      g.strokeStyle = 'rgba(60,35,15,0.25)';
      for (let k = 0; k < 6; k++) {
        g.beginPath();
        const y = row * pw + 8 + k * 9 + Math.random() * 4;
        g.moveTo(x, y);
        g.bezierCurveTo(x + 80, y + 4, x + 170, y - 4, x + 256, y + 2);
        g.stroke();
      }
      g.fillStyle = 'rgba(40,20,5,0.6)';
      g.fillRect(x, row * pw, 3, pw);
    }
    g.fillStyle = 'rgba(40,20,5,0.55)';
    g.fillRect(0, row * pw, 512, 2);
  }
});

const fabric = (base: string) => canvasTex(256, 256, (g) => {
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 3) {
    g.fillStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.05})`;
    g.fillRect(0, y, 256, 1);
  }
  for (let x = 0; x < 256; x += 3) {
    g.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.03})`;
    g.fillRect(x, 0, 1, 256);
  }
  speckle(g, 256, 256, 800, 0.05);
});

const wallpaper = () => canvasTex(256, 256, (g) => {
  g.fillStyle = '#e8dcc4';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#dccdb0';
  for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 14, 256);
  // Patinhas decorativas no papel de parede
  g.fillStyle = 'rgba(180,140,110,0.35)';
  for (let i = 0; i < 4; i++) {
    const px = 40 + (i % 2) * 128, py = 50 + Math.floor(i / 2) * 128;
    g.beginPath(); g.ellipse(px, py, 12, 10, 0, 0, Math.PI * 2); g.fill();
    for (let k = -1; k <= 1; k++) { g.beginPath(); g.arc(px + k * 10, py - 15, 5, 0, Math.PI * 2); g.fill(); }
  }
});

const cardboardSide = () => canvasTex(512, 512, (g) => {
  g.fillStyle = '#c49a6c';
  g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, 3000, 0.06);
  for (let y = 0; y < 512; y += 6) { g.fillStyle = 'rgba(120,80,40,0.06)'; g.fillRect(0, y, 512, 2); }
  // Fita adesiva
  g.fillStyle = 'rgba(210,180,130,0.9)';
  g.fillRect(0, 0, 512, 60);
  // Logo "Prime Meow" com sorriso
  g.fillStyle = '#1f2a36';
  g.font = 'bold 72px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('prime', 256, 270);
  g.font = 'bold 54px Arial, sans-serif';
  g.fillStyle = '#2f7fbf';
  g.fillText('MEOW', 256, 330);
  g.strokeStyle = '#e8932c';
  g.lineWidth = 10;
  g.lineCap = 'round';
  g.beginPath(); g.arc(256, 300, 110, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke();
  // Símbolos de "este lado para cima"
  g.strokeStyle = '#1f2a36'; g.lineWidth = 5;
  for (const x of [60, 100]) {
    g.beginPath(); g.moveTo(x, 470); g.lineTo(x, 420); g.moveTo(x - 12, 435); g.lineTo(x, 420); g.lineTo(x + 12, 435); g.stroke();
  }
  g.font = 'bold 22px Arial'; g.fillStyle = '#1f2a36'; g.textAlign = 'left';
  g.fillText('FRÁGIL — CONTÉM GATO', 150, 455);
}, false);

const cardboardTop = () => canvasTex(256, 256, (g) => {
  g.fillStyle = '#b88d5f';
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 1500, 0.06);
  g.fillStyle = 'rgba(215,190,140,0.95)';
  g.fillRect(100, 0, 56, 256);
  g.fillStyle = 'rgba(90,60,30,0.4)';
  g.fillRect(0, 126, 256, 4);
}, false);

const sisal = () => canvasTex(128, 128, (g) => {
  g.fillStyle = '#c9b183';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 6) {
    g.fillStyle = 'rgba(90,70,40,0.4)';
    g.fillRect(0, y, 128, 2);
    for (let x = 0; x < 128; x += 4) { g.fillStyle = `rgba(255,240,200,${Math.random() * 0.25})`; g.fillRect(x, y + 2, 3, 3); }
  }
});

const yarnTex = (color: string) => canvasTex(256, 128, (g) => {
  g.fillStyle = color;
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 3;
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    const y = Math.random() * 128;
    g.moveTo(0, y);
    g.bezierCurveTo(80, y + Math.random() * 60 - 30, 170, y + Math.random() * 60 - 30, 256, y);
    g.stroke();
  }
});

const rugTex = () => canvasTex(512, 512, (g) => {
  g.fillStyle = '#7a2e3b';
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#d8b25c'; g.lineWidth = 14;
  g.strokeRect(30, 30, 452, 452);
  g.strokeStyle = '#2f4f6f'; g.lineWidth = 8;
  g.strokeRect(60, 60, 392, 392);
  g.fillStyle = '#d8b25c';
  g.save(); g.translate(256, 256); g.rotate(Math.PI / 4);
  g.fillRect(-90, -90, 180, 180);
  g.fillStyle = '#7a2e3b'; g.fillRect(-60, -60, 120, 120);
  g.restore();
  speckle(g, 512, 512, 6000, 0.08);
}, false);

const skyTex = () => canvasTex(256, 256, (g) => {
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#7fb6e8'); grd.addColorStop(1, '#d9ecf7');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (const [x, y, r] of [[60, 70, 26], [90, 64, 32], [124, 74, 22], [180, 150, 20], [205, 144, 28]]) {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // Caixilho da janela
  g.fillStyle = '#f4efe6';
  g.fillRect(0, 0, 256, 10); g.fillRect(0, 246, 256, 10); g.fillRect(0, 0, 10, 256); g.fillRect(246, 0, 10, 256);
  g.fillRect(123, 0, 10, 256); g.fillRect(0, 123, 256, 10);
}, false);

// ── Texturas do Shipment ───────────────────────────────────────────────────

const steelDeck = () => canvasTex(512, 512, (g) => {
  g.fillStyle = '#5d6863';
  g.fillRect(0, 0, 512, 512);
  speckle(g, 512, 512, 5000, 0.07);
  // Chapas soldadas com rebites e padrão antiderrapante
  for (let py = 0; py < 512; py += 256) {
    for (let px = 0; px < 512; px += 256) {
      g.strokeStyle = 'rgba(25,30,28,0.7)'; g.lineWidth = 4;
      g.strokeRect(px + 2, py + 2, 252, 252);
      g.fillStyle = 'rgba(200,210,205,0.18)';
      for (let k = 12; k < 252; k += 24) for (const e of [10, 246]) {
        g.beginPath(); g.arc(px + k, py + e, 3, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(px + e, py + k, 3, 0, Math.PI * 2); g.fill();
      }
      g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 3;
      for (let y = 26; y < 236; y += 18) for (let x = 26; x < 236; x += 18) {
        const d = ((x + y) / 18) % 2 ? 1 : -1;
        g.beginPath(); g.moveTo(px + x - 5, py + y - 5 * d); g.lineTo(px + x + 5, py + y + 5 * d); g.stroke();
      }
    }
  }
  // Ferrugem
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 8 + Math.random() * 30;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(120,62,30,0.45)'); grd.addColorStop(1, 'rgba(120,62,30,0)');
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
});

/** Chapa corrugada em tons claros (tingida pela cor de cada contêiner). */
const corrugated = () => canvasTex(256, 256, (g) => {
  g.fillStyle = '#e6e6e6';
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 32) {
    const grd = g.createLinearGradient(x, 0, x + 32, 0);
    grd.addColorStop(0, '#b4b4b4'); grd.addColorStop(0.25, '#ffffff'); grd.addColorStop(0.55, '#d8d8d8'); grd.addColorStop(0.8, '#9a9a9a'); grd.addColorStop(1, '#b4b4b4');
    g.fillStyle = grd; g.fillRect(x, 0, 32, 256);
  }
  // Sujeira escorrida e ferrugem
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${90 + Math.random() * 40},${50 + Math.random() * 20},20,${0.08 + Math.random() * 0.12})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 4, 10 + Math.random() * 60);
  }
  speckle(g, 256, 256, 1200, 0.06);
});

/** Logo pintado na lateral dos contêineres. */
const containerLabel = () => canvasTex(512, 128, (g) => {
  g.clearRect(0, 0, 512, 128);
  g.fillStyle = 'rgba(255,255,255,0.88)';
  g.font = 'bold 64px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('MIAU LINE', 290, 66);
  // Patinha
  const px = 62, py = 70;
  g.beginPath(); g.ellipse(px, py + 10, 22, 18, 0, 0, Math.PI * 2); g.fill();
  for (const [dx, dy] of [[-22, -16], [-8, -30], [8, -30], [22, -16]]) { g.beginPath(); g.arc(px + dx, py + dy, 8, 0, Math.PI * 2); g.fill(); }
}, false);

const crateTex = () => canvasTex(256, 256, (g) => {
  const planks = ['#a87a48', '#9b6e3e', '#b3854f', '#a07240'];
  for (let i = 0; i < 6; i++) {
    g.fillStyle = planks[i % planks.length];
    g.fillRect(0, i * 43, 256, 43);
    g.fillStyle = 'rgba(60,35,15,0.5)'; g.fillRect(0, i * 43, 256, 2);
    g.strokeStyle = 'rgba(70,40,15,0.18)';
    for (let k = 0; k < 4; k++) { g.beginPath(); const y = i * 43 + 8 + k * 9; g.moveTo(0, y); g.bezierCurveTo(90, y + 3, 170, y - 3, 256, y + 1); g.stroke(); }
  }
  // Moldura e travessa em X
  g.fillStyle = '#7a532c';
  g.fillRect(0, 0, 256, 26); g.fillRect(0, 230, 256, 26); g.fillRect(0, 0, 26, 256); g.fillRect(230, 0, 26, 256);
  g.save(); g.translate(128, 128); g.rotate(Math.PI / 4); g.fillRect(-170, -12, 340, 24); g.restore();
  g.fillStyle = 'rgba(30,20,10,0.75)';
  g.font = 'bold 22px Arial'; g.textAlign = 'center';
  g.fillText('SACHÊ', 128, 70); g.fillText('FRÁGIL', 128, 200);
  speckle(g, 256, 256, 1500, 0.05);
}, false);

const barrelTex = () => canvasTex(256, 128, (g) => {
  g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  for (const y of [8, 42, 82, 116]) g.fillRect(0, y, 256, 5);
  g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(0, 50, 256, 2);
  speckle(g, 256, 128, 600, 0.08);
});

const seaTex = () => canvasTex(256, 256, (g) => {
  g.fillStyle = '#2d6688';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 160; i++) {
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '10,40,70'},${0.08 + Math.random() * 0.12})`;
    g.lineWidth = 1 + Math.random() * 2;
    const x = Math.random() * 256, y = Math.random() * 256, w = 10 + Math.random() * 30;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 3, x + w, y); g.stroke();
  }
});

const skyDome = () => canvasTex(16, 256, (g) => {
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#3f7fc4'); grd.addColorStop(0.45, '#8fbfe6'); grd.addColorStop(0.52, '#d6e6ef'); grd.addColorStop(1, '#d6e6ef');
  g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
}, false);

/** Ajusta as UVs de uma caixa ao tamanho real das faces (textura não estica). */
function worldUV(geo: THREE.BufferGeometry, sx: number, sy: number, sz: number, unit: number): THREE.BufferGeometry {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  // Ordem das faces da BoxGeometry: +x, -x, +y, -y, +z, -z (4 vértices cada)
  const dims: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / unit, uv.getY(i) * dims[f][1] / unit);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

export interface BuiltMap {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  /** Remove o mapa da cena e libera GPU (troca de mapa). */
  dispose(): void;
}

export function buildMap(scene: THREE.Scene, def: MapDef = MAP): BuiltMap {
  const group = new THREE.Group();
  scene.add(group);
  const ROOM = def.room;
  const W = ROOM.maxX - ROOM.minX, D = ROOM.maxZ - ROOM.minZ, H = ROOM.height;
  const outdoor = def.id === 'shipment';
  scene.background = new THREE.Color(outdoor ? 0xa9cbe6 : 0x2a2118);
  scene.fog = outdoor ? new THREE.Fog(0xc4d9e8, 70, 230) : new THREE.Fog(0x3a2e22, 60, 140);

  const loader = new THREE.TextureLoader();
  const pbr = (url: string, color: boolean, rx: number, ry: number) => {
    const t = loader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 8;
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  if (outdoor) shipmentShell(group, ROOM);
  else {
    // ── Piso, tapete, paredes e teto ─────────────────────────────────────────
    // Tacos de madeira PBR (Poly Haven "wood_floor", CC0); a textura procedural
    // fica como reserva até as imagens carregarem.
    const floorTex = woodFloor();
    floorTex.repeat.set(W / 10, D / 10);
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55 });
    loader.load('/tex/wood_floor_diff_1k.jpg', (diff) => {
      diff.wrapS = diff.wrapT = THREE.RepeatWrapping;
      diff.repeat.set(W / 6, D / 6);
      diff.colorSpace = THREE.SRGBColorSpace;
      diff.anisotropy = 8;
      floorMat.map = diff;
      floorMat.color.set(0xd9b48c); // aquece o tom para combinar com a sala
      floorMat.normalMap = pbr('/tex/wood_floor_nor_gl_1k.jpg', false, W / 6, D / 6);
      floorMat.roughnessMap = pbr('/tex/wood_floor_rough_1k.jpg', false, W / 6, D / 6);
      floorMat.roughness = 1;
      floorMat.needsUpdate = true;
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    group.add(floor);

    const rug = new THREE.Mesh(new THREE.PlaneGeometry(26, 18), new THREE.MeshStandardMaterial({ map: rugTex(), roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.02, 0);
    rug.receiveShadow = true;
    group.add(rug);

    const wpTex = wallpaper();
    const wallMat = (len: number) => {
      const t = wpTex.clone();
      t.needsUpdate = true;
      t.repeat.set(len / 8, H / 8);
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
    };
    const walls: [number, number, number, number, number][] = [
      // x, z, rotY, largura
      [0, ROOM.minZ, 0, W, 0],
      [0, ROOM.maxZ, Math.PI, W, 0],
      [ROOM.minX, 0, Math.PI / 2, D, 0],
      [ROOM.maxX, 0, -Math.PI / 2, D, 0],
    ];
    for (const [x, z, ry, len] of walls) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, H), wallMat(len));
      m.position.set(x, H / 2, z);
      m.rotation.y = ry;
      m.receiveShadow = true;
      group.add(m);
      const base = new THREE.Mesh(new THREE.BoxGeometry(len, 1.2, 0.3), new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.6 }));
      base.position.set(x, 0.6, z);
      base.rotation.y = ry;
      group.add(base);
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 1 }));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = H;
    group.add(ceil);

    // Janelas (luz do dia) nas paredes laterais
    for (const side of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.MeshBasicMaterial({ map: skyTex() }));
      win.position.set(side * (ROOM.maxX - 0.05), 12, 6);
      win.rotation.y = -side * Math.PI / 2;
      group.add(win);
    }
  }

  // ── Móveis ─────────────────────────────────────────────────────────────
  const mats = {
    // Trama de tecido real (Poly Haven "denim_fabric", CC0) tingida de verde-sofá
    sofa: new THREE.MeshStandardMaterial({
      map: fabric('#3f7f78'), roughness: 1,
      normalMap: pbr('/tex/denim_fabric_nor_gl_1k.jpg', false, 6, 6), normalScale: new THREE.Vector2(1.4, 1.4),
      roughnessMap: pbr('/tex/denim_fabric_rough_1k.jpg', false, 6, 6),
    }),
    cushion: new THREE.MeshStandardMaterial({
      map: fabric('#4f948c'), roughness: 1,
      normalMap: pbr('/tex/denim_fabric_nor_gl_1k.jpg', false, 4, 4), normalScale: new THREE.Vector2(1.4, 1.4),
      roughnessMap: pbr('/tex/denim_fabric_rough_1k.jpg', false, 4, 4),
    }),
    pillows: ['#e0a458', '#c9544d', '#6a8fc9', '#e8d9a8'].map((c) => new THREE.MeshStandardMaterial({ map: fabric(c), roughness: 0.95 })),
    wood: new THREE.MeshStandardMaterial({ color: 0x6b4428, roughness: 0.5 }),
    shelf: new THREE.MeshStandardMaterial({ color: 0xe9e2d4, roughness: 0.6 }),
    post: new THREE.MeshStandardMaterial({ map: sisal(), roughness: 1 }),
    platform: new THREE.MeshStandardMaterial({ color: 0xcbb89a, roughness: 1 }),
    mug: new THREE.MeshStandardMaterial({ color: 0xf6f3ee, roughness: 0.3 }),
    remote: new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.4 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.6, roughness: 0.4 }),
  };
  const cbSide = new THREE.MeshStandardMaterial({ map: cardboardSide(), roughness: 0.9 });
  const cbTop = new THREE.MeshStandardMaterial({ map: cardboardTop(), roughness: 0.9 });
  const cbPlain = new THREE.MeshStandardMaterial({ color: 0xc49a6c, roughness: 0.9 });
  const cardboardMats = [cbSide, cbSide, cbTop, cbPlain, cbSide, cbSide];
  const pageMat = new THREE.MeshStandardMaterial({ color: 0xf1e9d2, roughness: 0.9 });
  const goldBand = new THREE.MeshStandardMaterial({ color: 0xd8b25c, metalness: 0.4, roughness: 0.4 });
  // Um material por cor de capa (e não por livro), para a mesclagem juntar tudo
  const covers = new Map<number, THREE.MeshStandardMaterial>();
  const coverMat = (color: number) => {
    let m = covers.get(color);
    if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.7 }); covers.set(color, m); }
    return m;
  };

  // Shipment: chapa corrugada tingida por cor (um material por cor, para a mesclagem)
  const corrTex = corrugated();
  const ctMats = new Map<number, THREE.MeshStandardMaterial>();
  const ctMat = (color: number) => {
    let m = ctMats.get(color);
    if (!m) { m = new THREE.MeshStandardMaterial({ map: corrTex, color, roughness: 0.55, metalness: 0.35 }); ctMats.set(color, m); }
    return m;
  };
  const labelMat = new THREE.MeshStandardMaterial({ map: containerLabel(), transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  const crateMat = new THREE.MeshStandardMaterial({ map: crateTex(), roughness: 0.85 });
  const brlTex = barrelTex();
  const brlMats = new Map<number, THREE.MeshStandardMaterial>();
  const brlMat = (color: number) => {
    let m = brlMats.get(color);
    if (!m) { m = new THREE.MeshStandardMaterial({ map: brlTex, color, roughness: 0.45, metalness: 0.4 }); brlMats.set(color, m); }
    return m;
  };

  let pillowIdx = 0;
  for (const b of def.boxes) {
    if (b.kind === 'wall') continue;
    const mesh = meshFor(b);
    if (!mesh) continue;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  mergeStatic(group);

  function meshFor(b: Box): THREE.Object3D | null {
    const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const place = (m: THREE.Object3D) => { m.position.set(cx, cy, cz); return m; };
    const rounded = (r: number) => new RoundedBoxGeometry(sx, sy, sz, 3, Math.min(r, sx / 2, sy / 2, sz / 2));
    switch (b.kind) {
      case 'sofaBase': case 'sofaBack': case 'sofaArm':
        return place(new THREE.Mesh(rounded(0.5), mats.sofa));
      case 'cushion':
        return place(new THREE.Mesh(rounded(0.35), mats.cushion));
      case 'pillow':
        return place(new THREE.Mesh(rounded(0.55), mats.pillows[pillowIdx++ % mats.pillows.length]));
      case 'tableTop': case 'tableLeg':
        return place(new THREE.Mesh(rounded(0.08), mats.wood));
      case 'box': case 'bunker':
        return place(new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), cardboardMats));
      case 'shelf':
        return place(new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mats.shelf));
      case 'books': case 'book': {
        const g = new THREE.Group();
        const cover = coverMat(b.color ?? 0x884444);
        const body = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), [cover, cover, cover, cover, pageMat, cover]);
        body.castShadow = body.receiveShadow = true;
        g.add(body);
        // Faixa dourada na lombada
        const band = new THREE.Mesh(new THREE.BoxGeometry(sx * 1.01, Math.min(0.12, sy * 0.1), sz * 1.01), goldBand);
        band.position.y = sy * 0.3;
        g.add(band);
        return place(g);
      }
      case 'post': {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 16), mats.post);
        return place(m);
      }
      case 'platform':
        return place(new THREE.Mesh(rounded(0.1), mats.platform));
      case 'yarn': {
        const m = new THREE.Mesh(new THREE.SphereGeometry(sx / 2, 24, 16),
          new THREE.MeshStandardMaterial({ map: yarnTex('#' + (b.color ?? 0xd94f7a).toString(16).padStart(6, '0')), roughness: 1 }));
        return place(m);
      }
      case 'mug': {
        const g = new THREE.Group();
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(sx / 2, sx / 2 * 0.9, sy, 20), mats.mug);
        const handle = new THREE.Mesh(new THREE.TorusGeometry(sy * 0.25, 0.08, 8, 16), mats.mug);
        handle.position.x = sx / 2;
        const coffee = new THREE.Mesh(new THREE.CircleGeometry(sx / 2 * 0.9, 20), new THREE.MeshStandardMaterial({ color: 0x3b2314 }));
        coffee.rotation.x = -Math.PI / 2;
        coffee.position.y = sy / 2 - 0.1;
        g.add(cup, handle, coffee);
        g.traverse((o) => { o.castShadow = true; });
        return place(g);
      }
      case 'remote': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(rounded(0.1), mats.remote));
        const btnMat = new THREE.MeshStandardMaterial({ color: 0xc0392b });
        for (let i = 0; i < 4; i++) {
          const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10), i === 0 ? btnMat : mats.lamp);
          btn.position.set(0, sy / 2, -sz / 2 + 0.3 + i * 0.35);
          g.add(btn);
        }
        return place(g);
      }
      case 'lamp': {
        const g = new THREE.Group();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, sy, 10), mats.lamp);
        pole.position.y = 0;
        const base = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 0.3, 20), mats.lamp);
        base.position.y = -sy / 2 + 0.15;
        const shade = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.6, 2.6, 24, 1, true),
          new THREE.MeshStandardMaterial({ color: 0xf6e3b4, emissive: 0xffd28a, emissiveIntensity: 0.6, side: THREE.DoubleSide }));
        shade.position.y = sy / 2 + 0.6;
        g.add(pole, base, shade);
        return place(g);
      }
      case 'container': {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(worldUV(new THREE.BoxGeometry(sx, sy, sz), sx, sy, sz, 2), ctMat(b.color ?? 0x7d858c)));
        // Logo nas duas laterais compridas dos contêineres inteiros
        const len = Math.max(sx, sz);
        if (sy > 2 && Math.min(sx, sz) > 1 && len > 4) {
          const alongX = sx >= sz;
          for (const side of [-1, 1]) {
            const decal = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.6, len * 0.15), labelMat);
            const off = (alongX ? sz : sx) / 2 + 0.01;
            if (alongX) { decal.position.set(0, 0.25, side * off); decal.rotation.y = side > 0 ? 0 : Math.PI; }
            else { decal.position.set(side * off, 0.25, 0); decal.rotation.y = side * Math.PI / 2; }
            g.add(decal);
          }
        }
        return place(g);
      }
      case 'crate':
        return place(new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), crateMat));
      case 'barrel':
        return place(new THREE.Mesh(new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 18), brlMat(b.color ?? 0x2f6f9e)));
      default:
        return place(new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial({ color: b.color ?? 0x888888 })));
    }
  }

  // ── Iluminação ──────────────────────────────────────────────────────────
  // Sala: luz aconchegante de abajur; Shipment: sol forte de alto-mar + holofotes
  group.add(outdoor
    ? new THREE.HemisphereLight(0xdcecff, 0x59626a, 1.0)
    : new THREE.HemisphereLight(0xfff1dc, 0x6b4a33, 0.75)); // o HDRI complementa
  const sun = new THREE.DirectionalLight(outdoor ? 0xfff4e2 : 0xfff0d6, outdoor ? 3.0 : 2.2);
  sun.position.set(-26, outdoor ? 36 : 30, 14);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -40; sc.right = 40; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 100;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  group.add(sun, sun.target);
  for (const [x, y, z] of def.lamps) {
    const l = outdoor ? new THREE.PointLight(0xfff2d0, 25, 30, 1.6) : new THREE.PointLight(0xffc27a, 60, 45, 1.6);
    l.position.set(x, y, z);
    group.add(l);
  }
  if (!outdoor) {
    const fill = new THREE.PointLight(0xffe6c0, 40, 60, 1.5);
    fill.position.set(0, 18, 0);
    group.add(fill);
  }

  return {
    group,
    sun,
    dispose() {
      scene.remove(group);
      const textures = new Set<THREE.Texture>();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) textures.add(v as THREE.Texture);
          mat.dispose();
        }
      });
      for (const t of textures) t.dispose();
    },
  };
}

/** Convés, amurada, mar, céu, pilhas de contêineres ao redor e guindaste. */
function shipmentShell(group: THREE.Group, room: Room): void {
  const W = room.maxX - room.minX, D = room.maxZ - room.minZ;
  const deckW = W + 4, deckD = D + 10;

  const deckTex = steelDeck();
  deckTex.repeat.set(deckW / 8, deckD / 8);
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(deckW, deckD), new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.7, metalness: 0.3 }));
  deck.rotation.x = -Math.PI / 2;
  deck.receiveShadow = true;
  group.add(deck);

  // Faixas amarelas de segurança e escotilha central
  const paint = new THREE.MeshStandardMaterial({ color: 0xe0b52c, roughness: 0.6 });
  const stripe = (x: number, z: number, w: number, d: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paint);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.015, z);
    m.receiveShadow = true;
    group.add(m);
  };
  for (const sx of [-1, 1]) stripe(sx * (room.maxX - 0.6), 0, 0.35, D);
  for (const sz of [-1, 1]) stripe(0, sz * 5, 4.4, 0.25);

  // Casco e amurada nas laterais (x), com o mar logo abaixo
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x7a2a22, roughness: 0.7, metalness: 0.2 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xd9d2c0, roughness: 0.5, metalness: 0.4 });
  for (const sx of [-1, 1]) {
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1, 9, deckD + 20), hullMat);
    hull.position.set(sx * (deckW / 2 + 0.5), -3.5, 0);
    group.add(hull);
    const bulwark = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, deckD), railMat);
    bulwark.position.set(sx * (room.maxX + 0.15), 0.55, 0);
    bulwark.castShadow = bulwark.receiveShadow = true;
    group.add(bulwark);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, deckD, 8), railMat);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(sx * (room.maxX + 0.15), 2.1, 0);
    group.add(rail);
    for (let z = -deckD / 2 + 1; z <= deckD / 2 - 1; z += 2.5) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6), railMat);
      post.position.set(sx * (room.maxX + 0.15), 1.6, z);
      group.add(post);
    }
  }
  const seaT = seaTex();
  seaT.repeat.set(60, 60);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ map: seaT, color: 0x6fa0c0, roughness: 0.2, metalness: 0.1 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -6;
  group.add(sea);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(280, 24, 12), new THREE.MeshBasicMaterial({ map: skyDome(), side: THREE.BackSide, fog: false }));
  group.add(sky);

  // Paredões de contêineres empilhados nas pontas (z), além da área jogável
  const corr = corrugated();
  const colors = [0xb03a2e, 0x2f5f9e, 0x3f7d4a, 0xc9782c, 0x7d858c, 0x8a3f6b, 0x1f6f6f];
  const mats = colors.map((color) => new THREE.MeshStandardMaterial({ map: corr, color, roughness: 0.55, metalness: 0.35 }));
  let n = 0;
  for (const sz of [-1, 1]) {
    for (let row = 0; row < 2; row++) {
      const z = sz * (room.maxZ + 1.4 + row * 2.8);
      for (let x = -deckW / 2 - 3; x < deckW / 2; x += 7.2) {
        const levels = 3 + ((n * 7 + row) % 3 === 0 ? 1 : 0) - row;
        for (let y = 0; y < levels; y++) {
          const m = new THREE.Mesh(worldUV(new THREE.BoxGeometry(7, 2.6, 2.6), 7, 2.6, 2.6, 2), mats[(n * 5 + y * 3 + row) % mats.length]);
          m.position.set(x + 3.5, 1.3 + y * 2.62, z);
          m.castShadow = m.receiveShadow = true;
          group.add(m);
        }
        n++;
      }
    }
  }

  // Holofotes nos cantos
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f44, metalness: 0.6, roughness: 0.4 });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xfff2c8, emissiveIntensity: 1.2 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (room.maxX - 0.6), z = sz * (room.maxZ - 0.6);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 10, 8), poleMat);
    pole.position.set(x, 5, z);
    pole.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.5), poleMat);
    head.position.set(x - sx * 0.3, 10, z - sz * 0.3);
    head.lookAt(0, 0, 0);
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), glowMat);
    lens.position.set(0, 0, 0.26);
    head.add(lens);
    group.add(pole, head);
  }

  // Guindaste do porto ao fundo (silhueta amarela)
  const craneMat = new THREE.MeshStandardMaterial({ color: 0xe0a92c, roughness: 0.6, metalness: 0.3 });
  const crane = new THREE.Group();
  for (const lx of [-3, 3]) for (const lz of [-2, 2]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 26, 0.8), craneMat);
    leg.position.set(lx, 13, lz);
    crane.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 36), craneMat);
  beam.position.set(0, 26.5, 2);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.4, 3), craneMat);
  cab.position.set(0, 24.5, 8);
  crane.add(beam, cab);
  crane.position.set(-14, -6, -room.maxZ - 26);
  group.add(crane);
}
