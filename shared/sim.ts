// Simulação de movimento felino determinística. Roda no servidor (autoridade) e no
// cliente (predição + reconciliação), por isso não pode depender de nada além do mapa.

import { MAP_BOXES, type Box } from './map.ts';

export const RADIUS = 0.36;
export const STAND_H = 1.1;
export const CROUCH_H = 0.7;
// Olhos na altura da cabeça do gato de quatro patas (o que você vê = o que os outros veem)
export const STAND_EYE = 0.62;
export const CROUCH_EYE = 0.45;
export const STEP = 0.45;

const GRAVITY = 24;
const JUMP_V = 9.6; // pulo alto felino (~1.9 unidades)
const WALK = 7.2;
export const ZOOMIES = 11.5;
const ADS_SPEED_MULT = 0.6; // mirar (ADS) desacelera, como no CoD
const CROUCH_SPEED = 3.4;
const SLIDE_SPEED = 17;
const SLIDE_TIME = 0.75;
const GROUND_ACCEL = 70;
const AIR_ACCEL = 14;
export const STAMINA_MAX = 100;
const STAMINA_DRAIN = 28;
const STAMINA_REGEN = 16;

export interface PState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  onGround: boolean;
  crouch: boolean;
  slide: number; // tempo restante de deslize
  slideCd: number;
  stamina: number;
  sprinting: boolean;
}

export interface InputCmd {
  seq: number;
  dt: number;
  f: number; // -1..1 frente/trás
  s: number; // -1..1 direita/esquerda
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  yaw: number;
  pitch: number;
  ads?: boolean; // mirando: anda mais devagar e não corre
}

export function newState(x: number, y: number, z: number): PState {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false, slide: 0, slideCd: 0, stamina: STAMINA_MAX, sprinting: false };
}

export function copyState(s: PState): PState {
  return { ...s };
}

export function heightOf(s: PState): number {
  return s.crouch || s.slide > 0 ? CROUCH_H : STAND_H;
}

export function eyeY(s: PState): number {
  return s.y + (s.crouch || s.slide > 0 ? CROUCH_EYE : STAND_EYE);
}

function overlaps(b: Box, x: number, y: number, z: number, h: number): boolean {
  return (
    x + RADIUS > b.min[0] && x - RADIUS < b.max[0] &&
    y + h > b.min[1] && y < b.max[1] &&
    z + RADIUS > b.min[2] && z - RADIUS < b.max[2]
  );
}

export function collides(x: number, y: number, z: number, h: number): Box | null {
  for (const b of MAP_BOXES) if (overlaps(b, x, y, z, h)) return b;
  return null;
}

function moveAxis(s: PState, axis: 0 | 2, delta: number, h: number): void {
  if (delta === 0) return;
  const nx = axis === 0 ? s.x + delta : s.x;
  const nz = axis === 2 ? s.z + delta : s.z;
  const hit = collides(nx, s.y, nz, h);
  if (!hit) {
    s.x = nx; s.z = nz;
    return;
  }
  // Degrau automático: sobe obstáculos baixos (livros, tapetes, bordas)
  const rise = hit.max[1] - s.y;
  if (s.onGround && rise > 0 && rise <= STEP && !collides(nx, hit.max[1] + 0.001, nz, h)) {
    s.x = nx; s.z = nz; s.y = hit.max[1] + 0.001;
    return;
  }
  const eps = 0.0005;
  if (axis === 0) {
    s.x = delta > 0 ? hit.min[0] - RADIUS - eps : hit.max[0] + RADIUS + eps;
    s.vx = 0;
  } else {
    s.z = delta > 0 ? hit.min[2] - RADIUS - eps : hit.max[2] + RADIUS + eps;
    s.vz = 0;
  }
}

export function stepPlayer(s: PState, cmd: InputCmd): void {
  const dt = Math.min(cmd.dt, 0.05);
  const sinY = Math.sin(cmd.yaw), cosY = Math.cos(cmd.yaw);
  // Câmera three.js: yaw 0 olha para -Z
  let wx = -sinY * cmd.f + cosY * cmd.s;
  let wz = -cosY * cmd.f - sinY * cmd.s;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) { wx /= wl; wz /= wl; }

  s.slideCd = Math.max(0, s.slideCd - dt);
  const hspeed = Math.hypot(s.vx, s.vz);

  // Agachar / deslizar
  const wantCrouch = cmd.crouch;
  if (wantCrouch && !s.crouch && s.onGround && s.slide <= 0 && s.slideCd <= 0 && hspeed > WALK + 1) {
    s.slide = SLIDE_TIME;
    s.slideCd = 1.0;
    const k = SLIDE_SPEED / Math.max(hspeed, 0.001);
    s.vx *= k; s.vz *= k;
  }
  if (wantCrouch) s.crouch = true;
  else if (s.crouch || s.slide > 0) {
    // Só levanta se houver espaço acima
    if (!collides(s.x, s.y + 0.01, s.z, STAND_H)) { s.crouch = false; s.slide = 0; }
  }

  // Zoomies (arrancada) consome energia
  s.sprinting = cmd.sprint && !cmd.ads && cmd.f > 0 && !s.crouch && s.stamina > 1;
  if (s.sprinting && wl > 0.1) s.stamina = Math.max(0, s.stamina - STAMINA_DRAIN * dt);
  else s.stamina = Math.min(STAMINA_MAX, s.stamina + STAMINA_REGEN * dt);

  if (s.slide > 0) {
    s.slide -= dt;
    const fr = Math.max(0, 1 - 1.4 * dt);
    s.vx *= fr; s.vz *= fr;
  } else {
    const target = (s.crouch ? CROUCH_SPEED : s.sprinting ? ZOOMIES : WALK) * (cmd.ads ? ADS_SPEED_MULT : 1);
    const tx = wx * target, tz = wz * target;
    const accel = (s.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt;
    const dx = tx - s.vx, dz = tz - s.vz;
    const dl = Math.hypot(dx, dz);
    if (dl <= accel) { s.vx = tx; s.vz = tz; }
    else if (s.onGround || wl > 0.1) { s.vx += (dx / dl) * accel; s.vz += (dz / dl) * accel; }
  }

  if (cmd.jump && s.onGround) {
    s.vy = JUMP_V;
    s.onGround = false;
    if (s.slide > 0) { s.slide = 0; s.crouch = cmd.crouch; } // slide-jump mantém o embalo
  }

  s.vy -= GRAVITY * dt;
  if (s.vy < -40) s.vy = -40;

  const h = heightOf(s);
  moveAxis(s, 0, s.vx * dt, h);
  moveAxis(s, 2, s.vz * dt, h);

  // Eixo Y
  const ny = s.y + s.vy * dt;
  s.onGround = false;
  const hit = collides(s.x, ny, s.z, h);
  if (hit) {
    if (s.vy <= 0) { s.y = hit.max[1] + 0.0005; s.onGround = true; }
    else s.y = hit.min[1] - h - 0.0005;
    s.vy = 0;
  } else {
    s.y = ny;
  }
  if (s.y <= 0) { s.y = 0; s.vy = 0; s.onGround = true; }
}

// ── Raycast ────────────────────────────────────────────────────────────────

/** Interseção raio/AABB (método das placas). Retorna distância ou -1. */
export function rayAabb(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  min: readonly number[], max: readonly number[], maxDist: number,
): number {
  let tmin = 0, tmax = maxDist;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return -1;
    } else {
      const inv = 1 / d[i];
      let t1 = (min[i] - o[i]) * inv, t2 = (max[i] - o[i]) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

/** Distância até a primeira parede/móvel atingido pelo raio (ou maxDist). */
export function rayWorld(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number {
  let best = maxDist;
  for (const b of MAP_BOXES) {
    const t = rayAabb(ox, oy, oz, dx, dy, dz, b.min, b.max, best);
    if (t >= 0 && t < best) best = t;
  }
  if (dy < 0) {
    const tf = -oy / dy; // chão
    if (tf >= 0 && tf < best) best = tf;
  }
  return best;
}

/** Como rayWorld, mas também devolve a normal da superfície atingida (para marcas de bala). */
export function rayWorldHit(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number,
): { dist: number; normal: [number, number, number] | null } {
  let best = maxDist;
  let hitBox: Box | null = null;
  for (const b of MAP_BOXES) {
    const t = rayAabb(ox, oy, oz, dx, dy, dz, b.min, b.max, best);
    if (t >= 0 && t < best) { best = t; hitBox = b; }
  }
  if (dy < 0) {
    const tf = -oy / dy;
    if (tf >= 0 && tf < best) return { dist: tf, normal: [0, 1, 0] };
  }
  if (!hitBox) return { dist: best, normal: null };
  // Face mais próxima do ponto de impacto define a normal
  const p = [ox + dx * best, oy + dy * best, oz + dz * best];
  let normal: [number, number, number] = [0, 1, 0];
  let bestGap = Infinity;
  for (let i = 0; i < 3; i++) {
    const gMin = Math.abs(p[i] - hitBox.min[i]);
    const gMax = Math.abs(p[i] - hitBox.max[i]);
    if (gMin < bestGap) { bestGap = gMin; normal = [0, 0, 0]; normal[i] = -1; }
    if (gMax < bestGap) { bestGap = gMax; normal = [0, 0, 0]; normal[i] = 1; }
  }
  return { dist: best, normal };
}

/**
 * Hitboxes de um gato de quatro patas: corpo alongado na direção em que olha
 * (aproximado por uma AABB) e cabeça à frente, no alto.
 */
export function hitboxes(x: number, y: number, z: number, crouch: boolean, yaw = 0): { body: [number[], number[]]; head: [number[], number[]] } {
  const h = crouch ? CROUCH_H : STAND_H;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const half = 0.5, side = 0.26; // meio comprimento / meia largura do corpo
  const ex = Math.abs(fx) * half + Math.abs(fz) * side;
  const ez = Math.abs(fz) * half + Math.abs(fx) * side;
  // Medidas do modelo (Quaternius Cat): dorso até ~55% da altura, cabeça à
  // frente entre 28% e 78% da altura
  const bodyTop = y + h * 0.55;
  const hx = x + fx * 0.36, hz = z + fz * 0.36, hr = 0.2;
  return {
    body: [[x - ex, y, z - ez], [x + ex, bodyTop, z + ez]],
    head: [[hx - hr, y + h * 0.28, hz - hr], [hx + hr, y + h * 0.78, hz + hr]],
  };
}
