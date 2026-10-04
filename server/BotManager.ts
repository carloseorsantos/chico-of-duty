// IA dos gatinhos bots: patrulha pela malha de navegação, persegue o último ponto
// onde viu o inimigo, combate com strafe e mira imperfeita, e se esconde para ronronar.

import { eyeY, type InputCmd } from '../shared/sim.ts';
import { TICK_RATE } from '../shared/types.ts';
import { WEAPONS, type WeaponId } from '../shared/weapons.ts';
import { lineOfSight, navPoints } from './Physics.ts';
import type { BotBrain, Player } from './types.ts';

export const BOT_NAMES = [
  'Sgt. Bigodes', 'Cabo Miau', 'Ten. Novelo', 'Cap. Sardinha', 'Sd. Pantufa', 'Maj. Ronron',
  'Sd. Biscoito', 'Cabo Tigrinho', 'Ten. Sachê', 'Sgt. Pipoca', 'Cel. Frajola', 'Sd. Paçoca',
];

const VIEW_RANGE = 70;
const TURN_RATE = 7; // rad/s
const DT = 1 / TICK_RATE;

export function newBrain(): BotBrain {
  return {
    skill: 0.35 + Math.random() * 0.5,
    targetId: null, lastSeen: null, waypoint: null,
    stuckTime: 0, lastPos: [0, 0],
    reactUntil: 0, aimErrYaw: 0, aimErrPitch: 0, nextAimErr: 0,
    strafe: 1, strafeUntil: 0, jumpUntil: 0, crouchUntil: 0, seq: 0,
    hurtFrom: null,
  };
}

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function gauss(): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
}

export interface BotAction {
  cmd: InputCmd;
  fire: { dx: number; dy: number; dz: number } | null;
  reload: boolean;
  weapon: WeaponId;
}

/** Decide o próximo input do bot para este tick. */
export function thinkBot(bot: Player, players: Player[], now: number): BotAction {
  const b = bot.bot!;
  const s = bot.st;
  const eye = [s.x, eyeY(s), s.z];

  // ── Percepção: inimigo visível mais próximo ─────────────────────────────
  let target: Player | null = null;
  let targetDist = Infinity;
  for (const p of players) {
    if (!p.alive || p.team === bot.team) continue;
    const dx = p.st.x - s.x, dz = p.st.z - s.z;
    const dist = Math.hypot(dx, dz, p.st.y - s.y);
    if (dist > VIEW_RANGE || dist >= targetDist) continue;
    // Campo de visão de ~140°, a não ser que tenha acabado de levar tiro
    const ang = Math.abs(angleDiff(bot.yaw, Math.atan2(-dx, -dz)));
    const alert = b.hurtFrom && now - b.hurtFrom.time < 2500;
    if (ang > 1.25 && !alert && b.targetId !== p.id) continue;
    const chest = [p.st.x, p.st.y + (p.st.crouch ? 0.45 : 0.7), p.st.z];
    if (!lineOfSight(eye, chest)) continue;
    target = p; targetDist = dist;
  }

  if (target && b.targetId !== target.id) {
    // Tempo de reação humano ao avistar um novo alvo
    b.reactUntil = now + (550 - b.skill * 300) + Math.random() * 200;
  }
  b.targetId = target ? target.id : null;
  if (target) b.lastSeen = { x: target.st.x, y: target.st.y, z: target.st.z, time: now };

  const w = WEAPONS[bot.weapon];
  const mag = bot.ammo[bot.weapon];
  let weapon: WeaponId = bot.weapon;
  // Troca de arma conforme a distância (preferência leve por fuzil)
  if (target) {
    if (targetDist < 7) weapon = 1;
    else if (targetDist > 35 && b.skill > 0.6) weapon = 2;
    else weapon = 0;
  }

  let f = 0, st = 0, jump = false, sprint = false, crouch = false;
  let wantYaw = bot.yaw, wantPitch = 0;
  let fire: BotAction['fire'] = null;
  let reload = false;

  if (target) {
    // ── Combate ───────────────────────────────────────────────────────────
    if (now > b.nextAimErr) {
      const spread = (0.05 + targetDist * 0.0012) * (1.25 - b.skill);
      b.aimErrYaw = gauss() * spread;
      b.aimErrPitch = gauss() * spread * 0.6;
      b.nextAimErr = now + 350 + Math.random() * 300;
    }
    // Mira no peito; bots habilidosos às vezes buscam a cabeça
    const goHead = Math.random() < b.skill * 0.1;
    const aimY = target.st.y + (target.st.crouch ? 0.25 : 0.35) + (goHead ? 0.2 : 0);
    const fwd = goHead ? 0.36 : 0; // a cabeça fica à frente do corpo
    const ax = target.st.x - Math.sin(target.yaw) * fwd, az = target.st.z - Math.cos(target.yaw) * fwd;
    const dx = ax - s.x, dy = aimY - eye[1], dz = az - s.z;
    wantYaw = Math.atan2(-dx, -dz) + b.aimErrYaw;
    wantPitch = Math.atan2(dy, Math.hypot(dx, dz)) + b.aimErrPitch;

    if (now > b.strafeUntil) {
      b.strafe = Math.random() < 0.5 ? -1 : 1;
      b.strafeUntil = now + 500 + Math.random() * 900;
      if (Math.random() < 0.15) b.jumpUntil = now + 100;
      if (Math.random() < 0.2 * b.skill) b.crouchUntil = now + 900;
    }
    st = b.strafe;
    const ideal = weapon === 1 ? 5 : weapon === 2 ? 30 : 16;
    f = targetDist > ideal + 4 ? 1 : targetDist < ideal - 6 ? -0.7 : 0;
    jump = now < b.jumpUntil;
    crouch = now < b.crouchUntil && weapon !== 1;

    const aimed = Math.abs(angleDiff(bot.yaw, wantYaw)) < 0.12 && Math.abs(bot.pitch - wantPitch) < 0.12;
    if (weapon === bot.weapon && aimed && now >= b.reactUntil && mag > 0 && now >= bot.reloadUntil) {
      const burstPause = w.auto && Math.random() < 0.06 ? 250 : 0;
      if (now - bot.lastShot >= w.interval * 1000 + burstPause) {
        const cp = Math.cos(bot.pitch);
        fire = { dx: -Math.sin(bot.yaw) * cp, dy: Math.sin(bot.pitch), dz: -Math.cos(bot.yaw) * cp };
      }
    }
    if (mag <= 0 && now >= bot.reloadUntil) reload = true;
  } else {
    // ── Patrulha / caça / recuperação ───────────────────────────────────
    const hurt = bot.hp < 40 && now - bot.lastDamage > 1500;
    if (bot.ammo[bot.weapon] < WEAPONS[bot.weapon].mag * 0.5 && now >= bot.reloadUntil) reload = true;

    if (hurt) {
      // Fica agachado e parado para ronronar e recuperar vida
      crouch = true;
      if (b.hurtFrom) wantYaw = Math.atan2(-(b.hurtFrom.x - s.x), -(b.hurtFrom.z - s.z));
    } else {
      let goal: [number, number] | null = null;
      if (b.hurtFrom && now - b.hurtFrom.time < 3000) goal = [b.hurtFrom.x, b.hurtFrom.z];
      else if (b.lastSeen && now - b.lastSeen.time < 5000) goal = [b.lastSeen.x, b.lastSeen.z];
      if (goal && Math.hypot(goal[0] - s.x, goal[1] - s.z) < 2) { b.lastSeen = null; b.hurtFrom = null; goal = null; }

      if (!goal) {
        if (!b.waypoint || Math.hypot(b.waypoint[0] - s.x, b.waypoint[1] - s.z) < 1.5) b.waypoint = pickWaypoint(bot, players);
        goal = b.waypoint;
      }
      const dx = goal[0] - s.x, dz = goal[1] - s.z;
      wantYaw = Math.atan2(-dx, -dz);
      wantPitch = 0;
      f = Math.abs(angleDiff(bot.yaw, wantYaw)) < 1.2 ? 1 : 0.3;
      sprint = Math.hypot(dx, dz) > 12 && s.stamina > 40;

      // Travou? Pula. Continua travado? Novo destino.
      const moved = Math.hypot(s.x - b.lastPos[0], s.z - b.lastPos[1]);
      b.stuckTime = moved < 2.5 * DT ? b.stuckTime + DT : Math.max(0, b.stuckTime - DT);
      if (b.stuckTime > 0.35) jump = true;
      if (b.stuckTime > 0.35 && b.stuckTime < 0.8) st = b.strafe;
      if (b.stuckTime > 1.6) { b.waypoint = pickWaypoint(bot, players); b.lastSeen = null; b.hurtFrom = null; b.stuckTime = 0; b.strafe *= -1; }
    }
  }
  b.lastPos = [s.x, s.z];

  // Giro limitado: bots não viram 180° instantaneamente
  const maxTurn = TURN_RATE * (0.7 + b.skill * 0.6) * DT;
  const dyaw = angleDiff(bot.yaw, wantYaw);
  const yaw = bot.yaw + Math.max(-maxTurn, Math.min(maxTurn, dyaw));
  const pitch = bot.pitch + Math.max(-maxTurn, Math.min(maxTurn, wantPitch - bot.pitch));

  b.seq++;
  return {
    cmd: { seq: b.seq, dt: DT, f, s: st, jump, sprint, crouch, yaw, pitch },
    fire, reload, weapon,
  };
}

function pickWaypoint(bot: Player, players: Player[]): [number, number] {
  // Prefere pontos na direção dos inimigos vivos, com bastante aleatoriedade
  const enemies = players.filter((p) => p.alive && p.team !== bot.team);
  const nav = navPoints();
  let best = nav[(Math.random() * nav.length) | 0];
  let bestScore = -Infinity;
  for (let i = 0; i < 8; i++) {
    const c = nav[(Math.random() * nav.length) | 0];
    let score = Math.random() * 20;
    if (enemies.length) {
      const e = enemies[(Math.random() * enemies.length) | 0];
      score -= Math.hypot(c[0] - e.st.x, c[1] - e.st.z) * 0.6;
    }
    score -= Math.abs(Math.hypot(c[0] - bot.st.x, c[1] - bot.st.z) - 15) * 0.3;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return [best[0], best[1]];
}
