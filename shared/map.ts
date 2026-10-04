// Mapas do jogo — geometria compartilhada entre servidor (colisão/raycast) e
// cliente (renderização + predição). Unidades: 1 unidade ≈ 1 altura de gato em pé.
// Os mapas são espelhados no eixo X para que os dois times tenham o mesmo terreno.
//   • "A Sala de Estar Proibida": sala gigante em escala de gato.
//   • "Shipment": convés de navio cargueiro com contêineres, pequeno e caótico
//     (inspirado no clássico do CoD 4).
// O mapa ativo é trocado com setMap(); MAP_BOXES/ROOM/SPAWNS/LAMPS são "live
// bindings" e passam a apontar para o novo mapa em todos os módulos.

export type Kind =
  | 'wall' | 'sofaBase' | 'sofaBack' | 'sofaArm' | 'cushion' | 'pillow'
  | 'tableTop' | 'tableLeg' | 'box' | 'bunker' | 'shelf' | 'books' | 'book'
  | 'post' | 'platform' | 'yarn' | 'lamp' | 'mug' | 'remote'
  | 'container' | 'crate' | 'barrel';

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
  kind: Kind;
  color?: number;
}

export type MapId = 'sala' | 'shipment';

export interface Room { minX: number; maxX: number; minZ: number; maxZ: number; height: number }

export interface MapDef {
  id: MapId;
  name: string;
  room: Room;
  boxes: readonly Box[];
  /** Pontos de nascimento por time (pés no chão). */
  spawns: { orange: readonly (readonly number[])[]; black: readonly (readonly number[])[] };
  /** Luzes pontuais (abajures / holofotes). */
  lamps: [number, number, number][];
}

let boxes: Box[] = [];

function add(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, kind: Kind, color?: number): void {
  boxes.push({
    min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
    max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
    kind,
    color,
  });
}

/** Adiciona a peça no lado Laranja (x negativo) e o espelho no lado Preto. */
function mirrored(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, kind: Kind, color?: number): void {
  add(x0, y0, z0, x1, y1, z1, kind, color);
  add(-x0, y0, z0, -x1, y1, z1, kind, color);
}

/** Paredes de colisão em volta da área jogável (invisíveis no Shipment). */
function walls(room: Room): void {
  add(room.minX - 1, 0, room.minZ - 1, room.minX, room.height, room.maxZ + 1, 'wall');
  add(room.maxX, 0, room.minZ - 1, room.maxX + 1, room.height, room.maxZ + 1, 'wall');
  add(room.minX - 1, 0, room.minZ - 1, room.maxX + 1, room.height, room.minZ, 'wall');
  add(room.minX - 1, 0, room.maxZ, room.maxX + 1, room.height, room.maxZ + 1, 'wall');
}

// ═════════════════════════════════════════════════════════════════════════
// A Sala de Estar Proibida
// ═════════════════════════════════════════════════════════════════════════

/** Bunker de papelão "Prime Meow": 4 paredes, porta num lado e seteira no outro. */
function bunker(cx: number, cz: number, doorToNegX: boolean): void {
  const w = 2.6, h = 2.4, t = 0.22;
  const x0 = cx - w, x1 = cx + w, z0 = cz - w, z1 = cz + w;
  // Paredes norte/sul (inteiras)
  add(x0, 0, z0, x1, h, z0 + t, 'bunker');
  add(x0, 0, z1 - t, x1, h, z1, 'bunker');
  const doorX = doorToNegX ? x0 : x1 - t;
  const slitX = doorToNegX ? x1 - t : x0;
  // Parede com porta (abertura de 1.6 no meio)
  add(doorX, 0, z0, doorX + t, h, cz - 0.8, 'bunker');
  add(doorX, 0, cz + 0.8, doorX + t, h, z1, 'bunker');
  add(doorX, 1.6, cz - 0.8, doorX + t, h, cz + 0.8, 'bunker');
  // Parede com seteira horizontal (altura dos olhos em pé)
  add(slitX, 0, z0, slitX + t, 0.72, z1, 'bunker');
  add(slitX, 1.08, z0, slitX + t, h, z1, 'bunker');
}

function buildSala(): MapDef {
  boxes = [];
  const room: Room = { minX: -30, maxX: 30, minZ: -20, maxZ: 20, height: 22 };
  // ── Paredes da sala ────────────────────────────────────────────────────────
  walls(room);

  // ── Sofá gigante (norte) ─────────────────────────────────────────────────
  add(-12, 0, -19.5, 12, 2.6, -12, 'sofaBase');
  add(-12, 0, -20, 12, 6.5, -17.5, 'sofaBack');
  mirrored(-14, 0, -20, -12, 4, -12, 'sofaArm');
  mirrored(-11.7, 2.6, -17.5, -0.2, 3.2, -12.3, 'cushion');
  // Almofada encostada: degrau do assento para o topo do encosto (ninho de sniper)
  mirrored(-11, 3.2, -17.5, -8, 5.0, -15.4, 'pillow');
  // Almofadas no chão: degrau para subir no sofá
  mirrored(-8, 0, -11.8, -5, 1.6, -9, 'pillow');

  // ── Mesa de centro ─────────────────────────────────────────────────────────
  add(-6, 3.0, -3.5, 6, 3.5, 3.5, 'tableTop');
  mirrored(-6, 0, -3.5, -5.2, 3.0, -2.7, 'tableLeg');
  mirrored(-6, 0, 2.7, -5.2, 3.0, 3.5, 'tableLeg');
  mirrored(-10, 0, -1.5, -7, 1.9, 1.5, 'box'); // caixa-degrau até o tampo
  add(1.8, 3.5, 0.8, 3.2, 4.9, 2.2, 'mug');
  add(-4.2, 3.5, -2.6, -1.4, 3.9, -0.2, 'book', 0x3a5a8c);
  add(-1, 3.5, 1.2, 0.6, 3.75, 2.8, 'remote');

  // ── Estante com livros (sul) ─────────────────────────────────────────────
  add(-9, 0, 19.6, 9, 9.4, 20, 'shelf'); // fundo
  add(-9, 3.0, 16, 9, 3.3, 20, 'shelf');
  add(-9, 6.3, 16, 9, 6.6, 20, 'shelf');
  add(-9, 9.0, 16, 9, 9.4, 20, 'shelf');
  // Livros de pé na prateleira 1 (cobertura) e na 2 (decoração)
  const bookColors = [0x8c2f39, 0x2f5d8c, 0xd9a441, 0x3d7a4a, 0x6b3d8c, 0xc75b39];
  for (let i = 0; i < 6; i++) {
    const x = -7.5 + i * 2.7;
    add(x, 3.3, 17.8, x + 0.9, 3.3 + 2.0 + (i % 3) * 0.3, 19.6, 'book', bookColors[i]);
    add(x + 0.6, 6.6, 17.2, x + 1.7, 6.6 + 2.0, 19.6, 'book', bookColors[(i + 2) % 6]);
  }
  // Escada de livros deitados até a prateleira 1
  mirrored(-17, 0, 15.5, -15, 0.8, 19.6, 'books', 0x7a4a2f);
  mirrored(-15, 0, 15.5, -13, 1.6, 19.6, 'books', 0x2f5d8c);
  mirrored(-13, 0, 15.5, -9, 2.4, 19.6, 'books', 0x8c2f39);

  // ── Caixas "Prime Meow" e bunkers ───────────────────────────────────────
  bunker(-17, -2, true);
  bunker(17, -2, false);
  mirrored(-24, 0, 5, -21, 2.2, 8, 'box');
  mirrored(-17, 0, 8, -14, 1.6, 11, 'box');
  mirrored(-16.6, 1.6, 8.4, -14.4, 3.0, 10.6, 'box');
  mirrored(-8, 0, 7, -5.5, 1.4, 9.5, 'box');
  mirrored(-26, 0, -9, -23.5, 1.8, -6.5, 'box');

  // ── Arranhador / árvore de gato perto de cada spawn ─────────────────────
  mirrored(-22.5, 0, -14.5, -21.5, 7, -13.5, 'post');
  mirrored(-24, 1.3, -16, -21, 1.6, -13, 'platform');
  mirrored(-22, 3.0, -15, -19, 3.3, -12, 'platform');
  mirrored(-24, 4.7, -16, -20.5, 5.0, -12.5, 'platform');

  // ── Novelos de lã e abajures ────────────────────────────────────────────
  mirrored(-10, 0, 10, -8.6, 1.4, 11.4, 'yarn', 0xd94f7a);
  add(-0.8, 0, 12, 0.8, 1.6, 13.6, 'yarn', 0x4fa3d9);
  mirrored(-27.4, 0, -17.4, -26.6, 13, -16.6, 'lamp');

  return {
    id: 'sala',
    name: 'Sala de Estar Proibida',
    room,
    boxes,
    spawns: {
      orange: [[-27, 0, -3], [-27, 0, 3], [-27, 0, 10], [-25, 0, 15], [-20, 0, 14], [-27, 0, -12]],
      black: [[27, 0, -3], [27, 0, 3], [27, 0, 10], [25, 0, 15], [20, 0, 14], [27, 0, -12]],
    },
    lamps: [[-27, 13.5, -17], [27, 13.5, -17]],
  };
}

// ═════════════════════════════════════════════════════════════════════════
// Shipment — convés de cargueiro, grade 3×3 de contêineres
// ═════════════════════════════════════════════════════════════════════════

const CT_H = 2.6; // altura do contêiner (o pulo felino alcança ~1.9: suba pelas caixotes)
const CT_T = 0.2; // espessura da chapa dos contêineres vazados
const CT_COLORS = [0xb03a2e, 0x2f5f9e, 0x3f7d4a, 0xc9782c, 0x7d858c, 0x8a3f6b];

/** Contêiner fechado (AABB maciça). */
function container(x0: number, z0: number, x1: number, z1: number, color: number, y0 = 0): void {
  add(x0, y0, z0, x1, y0 + CT_H, z1, 'container', color);
}

/** Contêiner com as portas abertas nas duas pontas: dá para atravessar por dentro. */
function openContainer(x0: number, z0: number, x1: number, z1: number, color: number): void {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const lo = (a: number, b: number) => Math.min(a, b), hi = (a: number, b: number) => Math.max(a, b);
  if (alongX) {
    add(x0, 0, lo(z0, z1), x1, CT_H - CT_T, lo(z0, z1) + CT_T, 'container', color);
    add(x0, 0, hi(z0, z1) - CT_T, x1, CT_H - CT_T, hi(z0, z1), 'container', color);
  } else {
    add(lo(x0, x1), 0, z0, lo(x0, x1) + CT_T, CT_H - CT_T, z1, 'container', color);
    add(hi(x0, x1) - CT_T, 0, z0, hi(x0, x1), CT_H - CT_T, z1, 'container', color);
  }
  add(x0, CT_H - CT_T, z0, x1, CT_H, z1, 'container', color); // teto
}

function buildShipment(): MapDef {
  boxes = [];
  const room: Room = { minX: -20, maxX: 20, minZ: -20, maxZ: 20, height: 22 };
  walls(room);

  // ── Coluna central (x = 0): o famoso corredor do meio ────────────────────
  openContainer(-3.5, -1.3, 3.5, 1.3, CT_COLORS[0]);
  container(-1.3, -13.5, 1.3, -6.5, CT_COLORS[1]);
  container(-1.3, 6.5, 1.3, 13.5, CT_COLORS[2]);
  add(-0.7, 0, -4.7, 0.7, 1.2, -3.3, 'crate');
  add(-0.7, 0, 3.3, 0.7, 1.2, 4.7, 'crate');

  // ── Colunas laterais (x = ±9), espelhadas ───────────────────────────────
  container(-12.5, -11.3, -5.5, -8.7, CT_COLORS[3]);
  container(12.5, -11.3, 5.5, -8.7, CT_COLORS[3]);
  container(-12.5, 8.7, -5.5, 11.3, CT_COLORS[4]);
  container(12.5, 8.7, 5.5, 11.3, CT_COLORS[4]);
  openContainer(-10.3, -3.5, -7.7, 3.5, CT_COLORS[5]);
  openContainer(10.3, -3.5, 7.7, 3.5, CT_COLORS[5]);

  // Caixotes-degrau para subir nos contêineres (1.4 → 2.6)
  mirrored(-14.1, 0, -10.8, -12.5, 1.4, -9.2, 'crate');
  mirrored(-5.5, 0, 9.2, -3.9, 1.4, 10.8, 'crate');
  // Caixotes de cobertura
  mirrored(-5, 0, -5.6, -3.8, 1.2, -4.4, 'crate');
  mirrored(-5, 0, 4.4, -3.8, 1.2, 5.6, 'crate');
  mirrored(-15.2, 0, -3.2, -13.8, 1.2, -1.8, 'crate');
  mirrored(-15.2, 0, 1.8, -13.8, 1.2, 3.2, 'crate');
  mirrored(-15, 1.2, -3, -14, 2.0, -2, 'crate');
  // Barris (colisão em caixa, desenhados como cilindros)
  mirrored(-4.6, 0, -14.6, -3.8, 1.3, -13.8, 'barrel', 0x2f6f9e);
  mirrored(-4.6, 0, 13.8, -3.8, 1.3, 14.6, 'barrel', 0xc0392b);
  mirrored(-3.7, 0, 14.2, -2.9, 1.3, 15.0, 'barrel', 0x2f6f9e);
  mirrored(-17.8, 0, -18.8, -17.0, 1.3, -18.0, 'barrel', 0xd9a441);
  mirrored(-17.8, 0, 18.0, -17.0, 1.3, 18.8, 'barrel', 0xd9a441);

  return {
    id: 'shipment',
    name: 'Shipment',
    room,
    boxes,
    spawns: {
      orange: [[-17, 0, -15], [-17, 0, -6], [-17, 0, 0], [-17, 0, 6], [-17, 0, 15], [-15.5, 0, -17.5]],
      black: [[17, 0, -15], [17, 0, -6], [17, 0, 0], [17, 0, 6], [17, 0, 15], [15.5, 0, -17.5]],
    },
    lamps: [[-19, 10, -19], [19, 10, -19], [-19, 10, 19], [19, 10, 19]],
  };
}

export const MAPS: Record<MapId, MapDef> = { sala: buildSala(), shipment: buildShipment() };
/** Ordem de rotação entre partidas. */
export const MAP_ROTATION: readonly MapId[] = ['sala', 'shipment'];

// ── Mapa ativo (live bindings) ────────────────────────────────────────────
export let MAP: MapDef = MAPS.sala;
export let MAP_BOXES: readonly Box[] = MAP.boxes;
export let ROOM: Room = MAP.room;
export let SPAWNS: MapDef['spawns'] = MAP.spawns;
export let LAMPS: [number, number, number][] = MAP.lamps;

export function isMapId(id: unknown): id is MapId {
  return typeof id === 'string' && Object.hasOwn(MAPS, id);
}

/** Troca o mapa ativo (colisão, raycast, spawns). */
export function setMap(id: MapId): MapDef {
  MAP = MAPS[id];
  MAP_BOXES = MAP.boxes;
  ROOM = MAP.room;
  SPAWNS = MAP.spawns;
  LAMPS = MAP.lamps;
  return MAP;
}
