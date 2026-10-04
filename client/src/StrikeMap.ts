// Mapa tático para escolher o alvo do Bombardeio de Pombos (como o airstrike do
// CoD 4): visão de cima do mapa ativo, aliados, inimigos revelados e a faixa onde
// as bombas vão cair. O mouse move a mira; clique confirma, 4/botão direito cancela.

import { MAP } from '../../shared/map.ts';
import type { NetPlayer, Team } from '../../shared/types.ts';
import { AIRSTRIKE } from '../../shared/weapons.ts';
import { TEAM_ACCENT } from './CatModel.ts';

const MAX_W = 620, MAX_H = 440;

export class StrikeMap {
  open = false;
  /** Alvo atual em coordenadas do mundo. */
  x = 0;
  z = 0;
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private baseFor = '';
  private scale = 1;

  constructor() {
    this.root = document.getElementById('strike-map')!;
    this.canvas = this.root.querySelector('canvas')!;
    this.g = this.canvas.getContext('2d')!;
  }

  show(on: boolean, start?: { x: number; z: number }): void {
    this.open = on;
    this.root.classList.toggle('hidden', !on);
    if (on && start) { this.x = start.x; this.z = start.z; }
  }

  /** Move a mira com o deslocamento do mouse (px). */
  moveCursor(dx: number, dy: number): void {
    const r = MAP.room;
    this.x = Math.max(r.minX + 1, Math.min(r.maxX - 1, this.x + dx / this.scale));
    this.z = Math.max(r.minZ + 1, Math.min(r.maxZ - 1, this.z + dy / this.scale));
  }

  /** Planta baixa do mapa (cacheada por mapa): mais claro = mais alto. */
  private buildBase(): HTMLCanvasElement {
    const r = MAP.room;
    const W = r.maxX - r.minX, D = r.maxZ - r.minZ;
    this.scale = Math.min(MAX_W / W, MAX_H / D);
    const c = document.createElement('canvas');
    c.width = Math.round(W * this.scale);
    c.height = Math.round(D * this.scale);
    const g = c.getContext('2d')!;
    g.fillStyle = '#16211a';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = 'rgba(182,255,92,0.08)';
    for (let x = 0; x < c.width; x += this.scale * 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.height); g.stroke(); }
    for (let y = 0; y < c.height; y += this.scale * 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
    const boxes = MAP.boxes.filter((b) => b.kind !== 'wall').slice().sort((a, b) => a.max[1] - b.max[1]);
    for (const b of boxes) {
      const h = Math.min(1, b.max[1] / 8);
      const l = Math.round(60 + h * 120);
      g.fillStyle = `rgb(${l * 0.75},${l},${l * 0.7})`;
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      const [x, y] = this.toPx(b.min[0], b.min[2]);
      const w = (b.max[0] - b.min[0]) * this.scale, d = (b.max[2] - b.min[2]) * this.scale;
      g.fillRect(x, y, w, d);
      g.strokeRect(x + 0.5, y + 0.5, w - 1, d - 1);
    }
    g.strokeStyle = 'rgba(182,255,92,0.6)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, c.width - 2, c.height - 2);
    return c;
  }

  private toPx(x: number, z: number): [number, number] {
    return [(x - MAP.room.minX) * this.scale, (z - MAP.room.minZ) * this.scale];
  }

  draw(s: { me: { x: number; z: number; yaw: number; team: Team; id: number }; players: NetPlayer[]; noisy: Map<number, number>; now: number; uav: number }): void {
    if (!this.open) return;
    if (!this.base || this.baseFor !== MAP.id) { this.base = this.buildBase(); this.baseFor = MAP.id; }
    const c = this.canvas, g = this.g;
    if (c.width !== this.base.width || c.height !== this.base.height) { c.width = this.base.width; c.height = this.base.height; }
    g.drawImage(this.base, 0, 0);

    // Faixa das bombas: alinhada com a direção do time, centrada na mira
    const dirX = s.me.team === 'orange' ? 1 : -1;
    const pulse = 0.55 + 0.25 * Math.sin(s.now / 120);
    for (let i = 0; i < AIRSTRIKE.bombs; i++) {
      const off = (i - (AIRSTRIKE.bombs - 1) / 2) * AIRSTRIKE.spacing;
      const r = MAP.room;
      const bx = Math.max(r.minX + 1, Math.min(r.maxX - 1, this.x + dirX * off));
      const [px, py] = this.toPx(bx, this.z);
      g.fillStyle = `rgba(255,70,50,${0.18 * pulse})`;
      g.strokeStyle = `rgba(255,90,60,${pulse})`;
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(px, py, AIRSTRIKE.radius * this.scale, 0, Math.PI * 2); g.fill(); g.stroke();
    }

    // Gatos: aliados sempre; inimigos só se o drone estiver no ar ou atiraram há pouco
    for (const p of s.players) {
      if (!p.a || p.id === s.me.id) continue;
      const ally = p.tm === s.me.team;
      const noisyAt = s.uav > 0 ? s.now : s.noisy.get(p.id) ?? -1e9;
      if (!ally && s.now - noisyAt > 2500) continue;
      const [px, py] = this.toPx(p.x, p.z);
      g.fillStyle = ally ? TEAM_ACCENT[p.tm] : '#ff4d4d';
      g.strokeStyle = '#000';
      g.lineWidth = 1.5;
      g.beginPath();
      if (ally) g.arc(px, py, 5, 0, Math.PI * 2);
      else { g.moveTo(px, py - 7); g.lineTo(px + 6, py); g.lineTo(px, py + 7); g.lineTo(px - 6, py); g.closePath(); }
      g.fill(); g.stroke();
    }
    // Você
    const [mx, my] = this.toPx(s.me.x, s.me.z);
    g.save();
    g.translate(mx, my);
    g.rotate(-s.me.yaw);
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill();
    g.restore();

    // Mira
    const [cx, cy] = this.toPx(this.x, this.z);
    g.strokeStyle = '#b6ff5c';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx - 14, cy); g.lineTo(cx - 4, cy); g.moveTo(cx + 4, cy); g.lineTo(cx + 14, cy);
    g.moveTo(cx, cy - 14); g.lineTo(cx, cy - 4); g.moveTo(cx, cy + 4); g.lineTo(cx, cy + 14);
    g.stroke();
  }
}
