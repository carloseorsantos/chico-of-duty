// Regras do servidor: cadência, munição, recarga, dano/headshot, compensação de
// lag, cura por ronronado, killstreak, fim de partida e bots. Tempo simulado.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { newState, STAND_EYE } from '../shared/sim.ts';
import { SCORE_LIMIT, TEAM_SIZE, UAV_STREAK, type ServerMsg, type Team } from '../shared/types.ts';
import { burstReset, spreadFor, WEAPONS } from '../shared/weapons.ts';
import { GameManager } from '../server/GameManager.ts';
import type { Player } from '../server/types.ts';

let now = 1_000_000;
const realNow = Date.now;
beforeEach(() => { now = 1_000_000; Date.now = () => now; });
afterEach(() => { Date.now = realNow; });

interface Client { p: Player; msgs: ServerMsg[] }

function fakeWs(msgs: ServerMsg[]) {
  return { readyState: 1, send: (d: string) => msgs.push(JSON.parse(d)) } as never;
}

/** Jogo sem bots, com jogadores humanos controlados pelo teste. */
function setup(): { g: GameManager; join: (name: string, team: Team) => Client; tick: (ms?: number) => void } {
  const g = new GameManager();
  const dropBots = () => { for (const [id, p] of g.players) if (p.isBot) g.players.delete(id); };
  return {
    g,
    join(name, team) {
      const msgs: ServerMsg[] = [];
      const p = g.join(fakeWs(msgs), name, 'laranja', team);
      dropBots();
      return { p, msgs };
    },
    tick(ms = 1000 / 30) {
      now += ms;
      (g as unknown as { tick(): void }).tick();
      dropBots();
    },
  };
}

/** Posiciona `p` e aponta a mira de `from` para o ponto (x, y, z). */
function place(p: Player, x: number, z: number, yaw = 0): void {
  p.st = newState(x, 0, z);
  p.yaw = yaw;
  p.invUntil = 0;
  p.history.length = 0;
}

function shoot(g: GameManager, from: Player, w: number, target: [number, number, number], rt = Date.now()): void {
  const dx = target[0] - from.st.x, dy = target[1] - (from.st.y + STAND_EYE), dz = target[2] - from.st.z;
  g.handle(from, { t: 'switch', w: w as 0 });
  g.handle(from, { t: 'shoot', w: w as 0, dx, dy, dz, ads: true, rt });
}

// ── Armas ───────────────────────────────────────────────────────────────────

test('dispersão: parado < andando < correndo; no ar piora; ADS é mais preciso', () => {
  const m4 = WEAPONS[0];
  const still = spreadFor(m4, { ads: false, speed: 0, onGround: true, burst: 0 });
  const walk = spreadFor(m4, { ads: false, speed: 7, onGround: true, burst: 0 });
  const run = spreadFor(m4, { ads: false, speed: 11.5, onGround: true, burst: 0 });
  const air = spreadFor(m4, { ads: false, speed: 0, onGround: false, burst: 0 });
  const ads = spreadFor(m4, { ads: true, speed: 0, onGround: true, burst: 0 });
  assert.ok(still < walk && walk < run, `${still} < ${walk} < ${run}`);
  assert.ok(air > still && ads < still);
});

test('bloom: o 1º tiro é preciso e a rajada abre a dispersão (só no automático)', () => {
  const m4 = WEAPONS[0], sniper = WEAPONS[2];
  const first = spreadFor(m4, { ads: false, speed: 0, onGround: true, burst: 0 });
  const tenth = spreadFor(m4, { ads: false, speed: 0, onGround: true, burst: 9 });
  assert.ok(tenth > first * 2);
  assert.equal(spreadFor(sniper, { ads: true, speed: 0, onGround: true, burst: 5 }), 0);
  assert.ok(burstReset(m4) > m4.interval);
});

test('cadência: dois tiros no mesmo instante gastam só uma bala', () => {
  const { g, join } = setup();
  const a = join('Atirador', 'orange').p;
  place(a, 0, 0);
  shoot(g, a, 0, [0, 5, -20]);
  shoot(g, a, 0, [0, 5, -20]);
  assert.equal(a.ammo[0], WEAPONS[0].mag - 1);
});

test('munição acaba, bloqueia o tiro e a recarga completa o pente', () => {
  const { g, join, tick } = setup();
  const a = join('Atirador', 'orange').p;
  place(a, 0, 0);
  for (let i = 0; i < 35; i++) { shoot(g, a, 0, [0, 8, -20]); now += 110; }
  assert.equal(a.ammo[0], 0);
  g.handle(a, { t: 'reload', w: 0 });
  tick(WEAPONS[0].reload * 1000 - 200);
  assert.equal(a.ammo[0], 0, 'ainda recarregando');
  tick(400);
  assert.equal(a.ammo[0], WEAPONS[0].mag);
});

test('dano: corpo leva o dano base; a cabeça leva o multiplicador', () => {
  const { g, join } = setup();
  const a = join('Atirador', 'orange');
  const v = join('Alvo', 'black').p;
  place(a.p, 0, -6, Math.PI); // olhando para +Z
  place(v, 0, 0, 0); // olhando para -Z (cabeça voltada para o atirador)
  shoot(g, a.p, 0, [0, 0.2, 0]);
  const body = a.msgs.filter((m) => m.t === 'hit').at(-1) as Extract<ServerMsg, { t: 'hit' }>;
  assert.ok(body && !body.head && body.dmg === 24, `corpo: ${JSON.stringify(body)}`);
  now += 500;
  shoot(g, a.p, 0, [0, 0.62, -0.36]);
  const head = a.msgs.filter((m) => m.t === 'hit').at(-1) as Extract<ServerMsg, { t: 'hit' }>;
  assert.ok(head.head && head.dmg === Math.round(24 * 1.6), `cabeça: ${JSON.stringify(head)}`);
});

test('proteção de spawn: gato recém-nascido não leva dano', () => {
  const { g, join } = setup();
  const a = join('Atirador', 'orange').p;
  const v = join('Alvo', 'black').p;
  place(a, 0, -6, Math.PI);
  place(v, 0, 0);
  v.invUntil = now + 1500;
  shoot(g, a, 0, [0, 0.2, 0]);
  assert.equal(v.hp, 100);
});

test('compensação de lag: acerta onde o alvo estava na tela do atirador', () => {
  const { g, join, tick } = setup();
  const a = join('Atirador', 'orange').p;
  const v = join('Alvo', 'black').p;
  place(a, 0, -6, Math.PI);
  place(v, 0, 0);
  tick(); // registra o alvo em x=0
  const seenAt = now;
  v.st.x = 4; // o alvo já andou no servidor
  tick(100);
  shoot(g, a, 0, [0, 0.2, 0], seenAt);
  assert.ok(v.hp < 100, 'acertou a posição antiga (rewind)');
  const hp = v.hp;
  now += 500;
  shoot(g, a, 0, [0, 0.2, 0], now);
  assert.equal(v.hp, hp, 'sem rewind, o mesmo tiro erra');
});

test('ronronar: agachado e parado por 2,5 s recupera vida', () => {
  const { g, join, tick } = setup();
  const c = join('Ferido', 'orange').p;
  place(c, -25, 13);
  c.hp = 50;
  c.lastDamage = now;
  let seq = 0;
  for (let i = 0; i < 150; i++) {
    c.queue.push({ seq: ++seq, dt: 1 / 30, f: 0, s: 0, jump: false, sprint: false, crouch: true, yaw: 0, pitch: 0 });
    tick();
  }
  assert.ok(c.hp > 60, `vida após 5 s: ${c.hp.toFixed(1)}`);
  assert.ok(g.players.get(c.id)!.purring);
});

test('killstreak: 3 abates sem morrer chamam o Drone Pombo', () => {
  const { g, join } = setup();
  const a = join('Sniper', 'orange');
  const victims = [join('V1', 'black').p, join('V2', 'black').p, join('V3', 'black').p];
  place(a.p, 0, -6, Math.PI);
  for (const [i, v] of victims.entries()) {
    place(v, 0, 0);
    shoot(g, a.p, 2, [0, 0.62, -0.36]);
    assert.equal(v.alive, false, `vítima ${i + 1} abatida`);
    now += 1400;
    v.st.x = 30; // tira o corpo da frente
  }
  assert.equal(a.p.streak, UAV_STREAK);
  const streak = a.msgs.find((m) => m.t === 'streak');
  assert.ok(streak && streak.t === 'streak' && streak.kind === 'uav');
  assert.ok(g.uavUntil.orange > now);
  const kill = a.msgs.find((m) => m.t === 'kill') as Extract<ServerMsg, { t: 'kill' }>;
  assert.equal(kill.kh, 100);
  assert.equal(kill.dist, 6);
});

test('fim de partida aos 25 abates com MVP, e nova partida após o intervalo', () => {
  const { g, join, tick } = setup();
  const a = join('Craque', 'orange');
  const v = join('Alvo', 'black').p;
  g.score.orange = SCORE_LIMIT - 1;
  place(a.p, 0, -6, Math.PI);
  place(v, 0, 0);
  shoot(g, a.p, 2, [0, 0.62, -0.36]);
  const end = a.msgs.find((m) => m.t === 'end') as Extract<ServerMsg, { t: 'end' }>;
  assert.ok(end, 'mensagem de fim');
  assert.equal(end.winner, 'orange');
  assert.equal(end.mvp?.name, 'Craque');
  assert.equal(g.phase, 'ended');
  tick(10_500);
  assert.equal(g.phase, 'playing');
  assert.deepEqual(g.score, { orange: 0, black: 0 });
  assert.ok(a.msgs.some((m) => m.t === 'start'));
});

test('bots completam 4v4 e cedem vaga a humanos', () => {
  const g = new GameManager();
  const msgs: ServerMsg[] = [];
  g.join(fakeWs(msgs), 'Humano', 'laranja', 'orange');
  const count = (team: Team, bot: boolean) => [...g.players.values()].filter((p) => p.team === team && p.isBot === bot).length;
  assert.equal(count('orange', false) + count('orange', true), TEAM_SIZE);
  assert.equal(count('black', true), TEAM_SIZE);
  g.join(fakeWs([]), 'Humano 2', 'laranja', 'orange');
  assert.equal(count('orange', true), TEAM_SIZE - 2);
});

test('fumaça: 60 s de partida só com bots — combate acontece e ninguém sai do mapa', () => {
  const g = new GameManager();
  g.join(fakeWs([]), 'Espectador', 'laranja', 'orange');
  let kills = 0;
  const orig = g.broadcast.bind(g);
  g.broadcast = (m: ServerMsg) => { if (m.t === 'kill') kills++; orig(m); };
  for (let i = 0; i < 60 * 30; i++) {
    now += 1000 / 30;
    (g as unknown as { tick(): void }).tick();
    for (const p of g.players.values()) {
      assert.ok(Number.isFinite(p.st.x + p.st.y + p.st.z), `${p.name} com posição inválida`);
      assert.ok(Math.abs(p.st.x) < 30 && Math.abs(p.st.z) < 20 && p.st.y >= 0 && p.st.y < 22, `${p.name} fora do mapa`);
    }
  }
  assert.ok(kills >= 5, `abates em 60 s: ${kills}`);
});
