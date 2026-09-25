// Regras do Team Deathmatch felino: entrada/saída, balanceamento com bots, tiros,
// dano, abates, respawn, cura por ronronado e envio de snapshots a 30 Hz.

import type { WebSocket } from 'ws';
import { SPAWNS } from '../shared/map.ts';
import { copyState, newState, stepPlayer, type InputCmd } from '../shared/sim.ts';
import {
  MATCH_SECONDS, RADIO_LINES, RESPAWN_SECONDS, SCORE_LIMIT, SPAWN_PROTECT, TEAM_SIZE, TICK_RATE, UAV_SECONDS, UAV_STREAK,
  type ClientMsg, type NetPlayer, type ServerMsg, type Skin, type Team,
} from '../shared/types.ts';
import { burstReset, damageAt, MAX_HP, spreadFor, WEAPONS, type WeaponId } from '../shared/weapons.ts';
import { BOT_NAMES, newBrain, thinkBot } from './BotManager.ts';
import { eyeOf, recordHistory, traceShot } from './Physics.ts';
import type { Player } from './types.ts';

const SKINS: Skin[] = ['laranja', 'preto', 'rajado', 'siames'];
const INTERMISSION_MS = 10_000;
const r2 = (v: number) => Math.round(v * 100) / 100;

export class GameManager {
  players = new Map<number, Player>();
  score: Record<Team, number> = { orange: 0, black: 0 };
  phase: 'playing' | 'ended' = 'playing';
  /** Até quando o Drone Pombo de cada time revela os inimigos (ms). */
  uavUntil: Record<Team, number> = { orange: 0, black: 0 };
  matchEndsAt = Date.now() + MATCH_SECONDS * 1000;
  nextMatchAt = 0;
  private nextId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.balanceBots();
    this.timer = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ── Conexões ─────────────────────────────────────────────────────────────

  private createPlayer(name: string, team: Team, skin: Skin, ws: WebSocket | null): Player {
    const p: Player = {
      id: this.nextId++, name, team, skin, isBot: ws === null, ws,
      st: newState(0, 0, 0), yaw: 0, pitch: 0, hp: MAX_HP, alive: false, respawnAt: 0, invUntil: 0,
      kills: 0, deaths: 0, weapon: 0, ammo: WEAPONS.map((w) => w.mag), reloadUntil: 0, reloadW: 0,
      lastShot: 0, burst: 0, streak: 0, lastDamage: 0, purring: false, queue: [], ack: 0, ping: 0, history: [],
      bot: ws === null ? newBrain() : null,
    };
    this.players.set(p.id, p);
    this.spawn(p);
    return p;
  }

  join(ws: WebSocket, name: string, skin: Skin, pref: Team | 'auto'): Player {
    const humans = (t: Team) => [...this.players.values()].filter((p) => !p.isBot && p.team === t).length;
    let team: Team;
    if (pref === 'orange' || pref === 'black') team = pref;
    else if (humans('orange') !== humans('black')) team = humans('orange') < humans('black') ? 'orange' : 'black';
    else team = this.score.orange <= this.score.black ? 'orange' : 'black';

    const clean = (name || '').replace(/[<>&"]/g, '').trim().slice(0, 16) || 'Recruta Miau';
    const firstHuman = ![...this.players.values()].some((o) => !o.isBot);
    const p = this.createPlayer(clean, team, SKINS.includes(skin) ? skin : 'laranja', ws);
    // Servidor vazio: bots ficam parados; o primeiro humano começa uma partida nova
    if (firstHuman) this.newMatch(false);
    this.send(p, { t: 'welcome', id: p.id, team });
    this.broadcast({ t: 'info', msg: `${p.name} entrou no esquadrão ${team === 'orange' ? 'Laranja' : 'Preto'}` });
    this.balanceBots();
    return p;
  }

  leave(p: Player): void {
    this.players.delete(p.id);
    this.broadcast({ t: 'info', msg: `${p.name} saiu da partida` });
    this.balanceBots();
  }

  /** Bots completam cada time até TEAM_SIZE e cedem vaga para humanos. */
  private balanceBots(): void {
    for (const team of ['orange', 'black'] as Team[]) {
      const all = [...this.players.values()].filter((p) => p.team === team);
      const humans = all.filter((p) => !p.isBot).length;
      const bots = all.filter((p) => p.isBot);
      const want = Math.max(0, TEAM_SIZE - humans);
      while (bots.length > want) {
        const b = bots.pop()!;
        this.players.delete(b.id);
      }
      const used = new Set([...this.players.values()].map((p) => p.name));
      while (bots.length < want) {
        const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot ${this.nextId}`;
        used.add(name);
        bots.push(this.createPlayer(name, team, SKINS[(Math.random() * SKINS.length) | 0], null));
      }
    }
  }

  handle(p: Player, msg: ClientMsg): void {
    switch (msg.t) {
      case 'input':
        if (Array.isArray(msg.cmds)) {
          for (const c of msg.cmds.slice(0, 20)) if (typeof c.seq === 'number' && c.seq > p.ack) p.queue.push(c);
          if (p.queue.length > 30) p.queue.splice(0, p.queue.length - 30);
        }
        break;
      case 'shoot':
        this.fire(p, msg.w, msg.dx, msg.dy, msg.dz, !!msg.ads, Number(msg.rt) || Date.now());
        break;
      case 'reload':
        this.startReload(p, msg.w);
        break;
      case 'switch':
        if (WEAPONS[msg.w]) { p.weapon = msg.w; p.reloadUntil = 0; }
        break;
      case 'radio':
        if (RADIO_LINES[msg.id]) this.broadcastTeam(p.team, { t: 'radio', from: p.name, team: p.team, id: msg.id });
        break;
      case 'ping':
        this.send(p, { t: 'pong', c: msg.c });
        break;
    }
  }

  setPing(p: Player, ms: number): void {
    p.ping = Math.round(ms);
  }

  // ── Combate ──────────────────────────────────────────────────────────────

  private startReload(p: Player, w: WeaponId): void {
    const def = WEAPONS[w];
    if (!def || def.melee || !p.alive) return;
    const now = Date.now();
    if (p.ammo[w] >= def.mag || now < p.reloadUntil) return;
    p.weapon = w;
    p.reloadW = w;
    p.reloadUntil = now + def.reload * 1000;
  }

  private fire(p: Player, w: WeaponId, dx: number, dy: number, dz: number, ads: boolean, rewindTo: number): void {
    const def = WEAPONS[w];
    const now = Date.now();
    if (!def || !p.alive || this.phase !== 'playing') return;
    const len = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(len) || len < 0.5) return;
    dx /= len; dy /= len; dz /= len;
    if (now - p.lastShot < def.interval * 1000 * 0.8) return;
    if (!def.melee) {
      if (now < p.reloadUntil || p.ammo[w] <= 0) return;
      p.ammo[w]--;
    }
    p.weapon = w;
    // Bloom: conta tiros seguidos; uma pausa curta zera (1º tiro volta a ser preciso)
    p.burst = now - p.lastShot > burstReset(def) * 1000 ? 0 : p.burst + 1;
    p.lastShot = now;
    p.invUntil = 0; // atirar cancela a proteção de spawn

    const [ox, oy, oz] = eyeOf(p);
    const spread = spreadFor(def, { ads, speed: Math.hypot(p.st.vx, p.st.vz), onGround: p.st.onGround, burst: p.burst });
    const ends: number[][] = [];
    const dmgBy = new Map<Player, { dmg: number; head: boolean }>();
    // Base ortonormal para aplicar a dispersão
    const ux = Math.abs(dy) < 0.99 ? 0 : 1, uy = Math.abs(dy) < 0.99 ? 1 : 0;
    let rx = uy * dz, ry = -ux * dz, rz = ux * dy - uy * dx;
    const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
    const vx = ry * dz - rz * dy, vy = rz * dx - rx * dz, vz = rx * dy - ry * dx;

    for (let i = 0; i < def.pellets; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      const sx = Math.cos(a) * r, sy = Math.sin(a) * r;
      let px = dx + rx * sx + vx * sy, py = dy + ry * sx + vy * sy, pz = dz + rz * sx + vz * sy;
      const pl = Math.hypot(px, py, pz); px /= pl; py /= pl; pz /= pl;
      const tr = traceShot(p, ox, oy, oz, px, py, pz, def.range, this.players.values(), rewindTo);
      ends.push([r2(ox + px * tr.dist), r2(oy + py * tr.dist), r2(oz + pz * tr.dist)]);
      if (tr.victim) {
        const cur = dmgBy.get(tr.victim) ?? { dmg: 0, head: false };
        cur.dmg += damageAt(def, tr.dist) * (tr.head ? def.headMult : 1);
        cur.head ||= tr.head;
        dmgBy.set(tr.victim, cur);
      }
    }

    for (const other of this.players.values()) {
      if (other !== p) this.send(other, { t: 'shot', id: p.id, w, o: [r2(ox), r2(oy), r2(oz)], ends: def.melee ? [] : ends });
    }
    for (const [victim, d] of dmgBy) this.damage(p, victim, Math.round(d.dmg), d.head, w);
  }

  private damage(attacker: Player, victim: Player, dmg: number, head: boolean, w: WeaponId): void {
    const now = Date.now();
    if (!victim.alive || now < victim.invUntil || dmg <= 0) return;
    victim.hp -= dmg;
    victim.lastDamage = now;
    victim.purring = false;
    if (victim.bot) victim.bot.hurtFrom = { x: attacker.st.x, z: attacker.st.z, time: now };
    const kill = victim.hp <= 0;
    this.send(attacker, { t: 'hit', head, kill, dmg });
    this.send(victim, { t: 'dmg', fx: attacker.st.x, fz: attacker.st.z, hp: Math.max(0, victim.hp) });
    if (!kill) return;

    victim.hp = 0;
    victim.alive = false;
    victim.deaths++;
    victim.streak = 0;
    victim.respawnAt = now + RESPAWN_SECONDS * 1000;
    attacker.kills++;
    this.score[attacker.team]++;
    this.broadcast({
      t: 'kill', killer: attacker.id, victim: victim.id, w, head,
      kn: attacker.name, vn: victim.name, kt: attacker.team, vt: victim.team,
      kh: Math.max(0, Math.ceil(attacker.hp)),
      dist: Math.round(Math.hypot(attacker.st.x - victim.st.x, attacker.st.y - victim.st.y, attacker.st.z - victim.st.z)),
    });
    // Killstreak: 3 abates sem morrer chamam o Drone Pombo (UAV)
    if (attacker.alive) attacker.streak++;
    if (attacker.streak > 0 && attacker.streak % UAV_STREAK === 0) {
      this.uavUntil[attacker.team] = Date.now() + UAV_SECONDS * 1000;
      this.broadcast({ t: 'streak', id: attacker.id, name: attacker.name, team: attacker.team, kind: 'uav', seconds: UAV_SECONDS });
    }
    if (this.score[attacker.team] >= SCORE_LIMIT) this.endMatch(attacker.team);
  }

  private spawn(p: Player): void {
    const enemies = [...this.players.values()].filter((o) => o.alive && o.team !== p.team);
    let best: readonly number[] = SPAWNS[p.team][0];
    let bestScore = -Infinity;
    for (const sp of SPAWNS[p.team]) {
      let minD = 999;
      for (const e of enemies) minD = Math.min(minD, Math.hypot(e.st.x - sp[0], e.st.z - sp[2]));
      const score = minD + Math.random() * 6;
      if (score > bestScore) { bestScore = score; best = sp; }
    }
    p.st = newState(best[0], best[1], best[2]);
    p.yaw = p.team === 'orange' ? -Math.PI / 2 : Math.PI / 2;
    p.pitch = 0;
    p.hp = MAX_HP;
    p.alive = true;
    p.invUntil = Date.now() + SPAWN_PROTECT * 1000;
    p.ammo = WEAPONS.map((w) => w.mag);
    p.reloadUntil = 0;
    p.weapon = 0;
    p.queue.length = 0;
    p.history.length = 0;
  }

  private endMatch(winner: Team | 'draw'): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.nextMatchAt = Date.now() + INTERMISSION_MS;
    this.broadcast({ t: 'end', winner, nextIn: INTERMISSION_MS / 1000, mvp: this.mvp() });
  }

  /** Melhor jogador: mais abates, desempate por menos mortes. */
  mvp(): { name: string; team: Team; k: number; d: number } | null {
    const best = [...this.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0];
    return best && best.kills > 0 ? { name: best.name, team: best.team, k: best.kills, d: best.deaths } : null;
  }

  private newMatch(announce = true): void {
    this.phase = 'playing';
    this.score = { orange: 0, black: 0 };
    this.uavUntil = { orange: 0, black: 0 };
    this.matchEndsAt = Date.now() + MATCH_SECONDS * 1000;
    for (const p of this.players.values()) {
      p.kills = 0; p.deaths = 0; p.streak = 0;
      p.alive = false;
    }
    for (const p of this.players.values()) this.spawn(p);
    if (announce) this.broadcast({ t: 'start' });
  }

  // ── Loop principal ───────────────────────────────────────────────────────

  private tick(): void {
    const now = Date.now();
    const list = [...this.players.values()];
    if (!list.some((p) => !p.isBot)) {
      this.matchEndsAt = now + MATCH_SECONDS * 1000;
      return;
    }

    if (this.phase === 'playing' && now >= this.matchEndsAt) {
      const { orange, black } = this.score;
      this.endMatch(orange === black ? 'draw' : orange > black ? 'orange' : 'black');
    }
    if (this.phase === 'ended' && now >= this.nextMatchAt) this.newMatch();

    for (const p of list) {
      if (!p.alive) {
        p.queue.length = 0;
        if (now >= p.respawnAt && this.phase === 'playing') this.spawn(p);
        continue;
      }

      if (p.bot) {
        const act = thinkBot(p, list, now);
        if (act.weapon !== p.weapon) { p.weapon = act.weapon; p.reloadUntil = 0; }
        this.simulate(p, act.cmd);
        if (act.reload) this.startReload(p, p.weapon);
        if (act.fire) this.fire(p, p.weapon, act.fire.dx, act.fire.dy, act.fire.dz, Math.random() < 0.6, now);
      } else {
        // Processa os inputs acumulados (limite anti speed-hack)
        let budget = 0.12;
        while (p.queue.length && budget > 0) {
          const cmd = p.queue.shift()!;
          budget -= Math.min(cmd.dt, 0.05);
          this.simulate(p, cmd);
          p.ack = cmd.seq;
        }
      }

      // Recarga concluída
      if (p.reloadUntil && now >= p.reloadUntil) {
        p.ammo[p.reloadW] = WEAPONS[p.reloadW].mag;
        p.reloadUntil = 0;
      }

      // Ronronar: agachado, parado e sem levar dano há 2,5 s → cura
      const still = Math.hypot(p.st.vx, p.st.vz) < 0.5;
      p.purring = p.hp < MAX_HP && p.st.crouch && still && p.st.onGround && now - p.lastDamage > 2500;
      if (p.purring) p.hp = Math.min(MAX_HP, p.hp + (14 / TICK_RATE));
    }

    for (const p of list) recordHistory(p, now);
    this.sendSnapshots(now, list);
  }

  private simulate(p: Player, cmd: InputCmd): void {
    const c: InputCmd = {
      seq: cmd.seq, dt: Math.max(0, Math.min(Number(cmd.dt) || 0, 0.05)),
      f: clamp1(cmd.f), s: clamp1(cmd.s), jump: !!cmd.jump, sprint: !!cmd.sprint, crouch: !!cmd.crouch,
      yaw: Number(cmd.yaw) || 0, pitch: Math.max(-1.55, Math.min(1.55, Number(cmd.pitch) || 0)), ads: !!cmd.ads,
    };
    stepPlayer(p.st, c);
    p.yaw = c.yaw;
    p.pitch = c.pitch;
  }

  private sendSnapshots(now: number, list: Player[]): void {
    const players: NetPlayer[] = list.map((p) => ({
      id: p.id, n: p.name, tm: p.team, sk: p.skin,
      x: r2(p.st.x), y: r2(p.st.y), z: r2(p.st.z), yw: r2(p.yaw), pt: r2(p.pitch),
      hp: Math.ceil(p.hp), cr: p.st.crouch || p.st.slide > 0, sl: p.st.slide > 0,
      w: p.weapon, a: p.alive, bot: p.isBot, k: p.kills, d: p.deaths,
      inv: now < p.invUntil, pu: p.purring, pg: p.ping, st: p.streak,
    }));
    const timeLeft = Math.max(0, Math.round((this.matchEndsAt - now) / 1000));
    for (const p of list) {
      if (!p.ws) continue;
      this.send(p, {
        t: 'snap', time: now, players, score: this.score, timeLeft, phase: this.phase,
        uav: { orange: Math.max(0, (this.uavUntil.orange - now) / 1000), black: Math.max(0, (this.uavUntil.black - now) / 1000) },
        me: {
          ack: p.ack, st: copyState(p.st), ammo: p.ammo.map((a) => (Number.isFinite(a) ? a : -1)),
          respawnIn: p.alive ? 0 : Math.max(0, (p.respawnAt - now) / 1000),
        },
      });
    }
  }

  send(p: Player, msg: ServerMsg): void {
    if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.ws && p.ws.readyState === 1) p.ws.send(data);
  }

  private broadcastTeam(team: Team, msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.team === team && p.ws && p.ws.readyState === 1) p.ws.send(data);
  }
}

function clamp1(v: unknown): number {
  const n = Number(v) || 0;
  return Math.max(-1, Math.min(1, n));
}

