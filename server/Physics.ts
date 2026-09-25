// Física autoritária: resolução de tiros (raycast contra mapa + hitboxes com
// compensação de lag), linha de visão e malha de pontos de navegação dos bots.

import { ROOM } from '../shared/map.ts';
import { collides, eyeY, hitboxes, rayAabb, rayWorld, STAND_H } from '../shared/sim.ts';
import type { HistoryEntry, Player } from './types.ts';

const MAX_REWIND_MS = 300;

/** Posição do jogador no instante `time` (interpolada no histórico). */
export function positionAt(p: Player, time: number): HistoryEntry {
  const h = p.history;
  const now: HistoryEntry = { time: Date.now(), x: p.st.x, y: p.st.y, z: p.st.z, crouch: p.st.crouch || p.st.slide > 0, alive: p.alive, yaw: p.yaw };
  if (h.length === 0 || time >= now.time) return now;
  for (let i = h.length - 1; i >= 0; i--) {
    const a = h[i];
    if (a.time <= time) {
      const b = h[i + 1] ?? now;
      const span = b.time - a.time;
      const t = span > 0 ? (time - a.time) / span : 0;
      return {
        time,
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        crouch: t < 0.5 ? a.crouch : b.crouch,
        alive: a.alive && b.alive,
        yaw: t < 0.5 ? a.yaw : b.yaw,
      };
    }
  }
  return h[0];
}

export function recordHistory(p: Player, time: number): void {
  p.history.push({ time, x: p.st.x, y: p.st.y, z: p.st.z, crouch: p.st.crouch || p.st.slide > 0, alive: p.alive, yaw: p.yaw });
  while (p.history.length > 0 && time - p.history[0].time > 1000) p.history.shift();
}

export interface TraceResult {
  dist: number;
  victim: Player | null;
  head: boolean;
}

/** Raio de tiro: primeiro obstáculo ou inimigo atingido. Aliados não bloqueiam. */
export function traceShot(
  shooter: Player, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  range: number, players: Iterable<Player>, rewindTo: number,
): TraceResult {
  const now = Date.now();
  const t = Math.max(now - MAX_REWIND_MS, Math.min(now, rewindTo));
  let best = rayWorld(ox, oy, oz, dx, dy, dz, range);
  let victim: Player | null = null;
  let head = false;
  for (const p of players) {
    if (p === shooter || !p.alive || p.team === shooter.team) continue;
    const pos = positionAt(p, t);
    if (!pos.alive) continue;
    const hb = hitboxes(pos.x, pos.y, pos.z, pos.crouch, pos.yaw);
    const th = rayAabb(ox, oy, oz, dx, dy, dz, hb.head[0], hb.head[1], best);
    if (th >= 0 && th < best) { best = th; victim = p; head = true; }
    const tb = rayAabb(ox, oy, oz, dx, dy, dz, hb.body[0], hb.body[1], best);
    if (tb >= 0 && tb < best) { best = tb; victim = p; head = false; }
  }
  return { dist: best, victim, head };
}

export function eyeOf(p: Player): [number, number, number] {
  return [p.st.x, eyeY(p.st), p.st.z];
}

/** Há visão livre entre dois pontos? */
export function lineOfSight(a: readonly number[], b: readonly number[]): boolean {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 0.01) return true;
  return rayWorld(a[0], a[1], a[2], dx / len, dy / len, dz / len, len) >= len - 0.05;
}

/** Grade de pontos livres no chão para a navegação dos bots. */
export const NAV_POINTS: [number, number][] = (() => {
  const pts: [number, number][] = [];
  for (let x = ROOM.minX + 2; x <= ROOM.maxX - 2; x += 3) {
    for (let z = ROOM.minZ + 2; z <= ROOM.maxZ - 2; z += 3) {
      // folga extra em volta do ponto para o bot não travar em quinas
      if (!collides(x, 0.01, z, STAND_H) && !collides(x + 0.6, 0.01, z, STAND_H) && !collides(x - 0.6, 0.01, z, STAND_H) &&
          !collides(x, 0.01, z + 0.6, STAND_H) && !collides(x, 0.01, z - 0.6, STAND_H)) {
        pts.push([x, z]);
      }
    }
  }
  return pts;
})();
