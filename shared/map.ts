// "A Sala de Estar Proibida" — geometria compartilhada entre servidor (colisão/raycast)
// e cliente (renderização + predição). Unidades: 1 unidade ≈ 1 altura de gato em pé.
// O mapa é espelhado no eixo X para que os dois times tenham o mesmo terreno.

export type Kind =
  | 'wall' | 'sofaBase' | 'sofaBack' | 'sofaArm' | 'cushion' | 'pillow'
  | 'tableTop' | 'tableLeg' | 'box' | 'bunker' | 'shelf' | 'books' | 'book'
  | 'post' | 'platform' | 'yarn' | 'lamp' | 'mug' | 'remote';

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
  kind: Kind;
  color?: number;
}

export const ROOM = { minX: -30, maxX: 30, minZ: -20, maxZ: 20, height: 22 };

const boxes: Box[] = [];

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

// ── Paredes da sala ────────────────────────────────────────────────────────
add(-31, 0, -21, -30, ROOM.height, 21, 'wall');
add(30, 0, -21, 31, ROOM.height, 21, 'wall');
add(-31, 0, -21, 31, ROOM.height, -20, 'wall');
add(-31, 0, 20, 31, ROOM.height, 21, 'wall');

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

export const MAP_BOXES: readonly Box[] = boxes;

/** Pontos de nascimento por time (pés no chão). */
export const SPAWNS = {
  orange: [
    [-27, 0, -3], [-27, 0, 3], [-27, 0, 10], [-25, 0, 15], [-20, 0, 14], [-27, 0, -12],
  ],
  black: [
    [27, 0, -3], [27, 0, 3], [27, 0, 10], [25, 0, 15], [20, 0, 14], [27, 0, -12],
  ],
} as const;

/** Luzes: abajures (posição da cúpula). */
export const LAMPS: [number, number, number][] = [[-27, 13.5, -17], [27, 13.5, -17]];
