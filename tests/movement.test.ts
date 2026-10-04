// Movimento felino: alturas, pulo, slide, ADS e rotas até os móveis altos.
// Roda com `npm test` (node:test, TypeScript nativo do Node).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAP_ROTATION, MAPS, setMap } from '../shared/map.ts';
import { collides, CROUCH_EYE, eyeY, newState, STAND_EYE, STAND_H, stepPlayer, type InputCmd, type PState } from '../shared/sim.ts';
import { navPoints } from '../server/Physics.ts';

const DT = 1 / 60;
let seq = 0;
function cmd(o: Partial<InputCmd> = {}): InputCmd {
  return { seq: ++seq, dt: DT, f: 0, s: 0, jump: false, sprint: false, crouch: false, yaw: 0, pitch: 0, ...o };
}

/** Segura os comandos por `seconds` e devolve a maior altura atingida. */
function hold(s: PState, seconds: number, o: Partial<InputCmd>): number {
  let maxY = s.y;
  for (let i = 0; i < seconds * 60; i++) {
    stepPlayer(s, cmd(o));
    maxY = Math.max(maxY, s.y);
  }
  return maxY;
}

test('olhos na altura da cabeça do gato (em pé e agachado)', () => {
  const s = newState(0, 0, 0);
  assert.equal(eyeY(s), STAND_EYE);
  s.crouch = true;
  assert.equal(eyeY(s), CROUCH_EYE);
});

test('pulo alto felino alcança ~1,9 unidade', () => {
  const s = newState(0, 0, 0);
  hold(s, 0.2, {});
  const peak = hold(s, 1, { jump: true });
  assert.ok(peak > 1.8 && peak < 2.1, `altura do pulo = ${peak.toFixed(2)}`);
});

test('Zoomies correm mais que andar e gastam energia', () => {
  const walk = newState(-25, 0, 13);
  hold(walk, 1, { f: 1, yaw: -Math.PI / 2 });
  const run = newState(-25, 0, 13.9);
  hold(run, 1, { f: 1, sprint: true, yaw: -Math.PI / 2 });
  assert.ok(Math.hypot(run.vx, run.vz) > Math.hypot(walk.vx, walk.vz) + 3);
  assert.ok(run.stamina < 100);
});

test('slide: correndo e agachando dá um impulso e baixa a altura', () => {
  const s = newState(-25, 0, 13); // corredor livre entre as caixas e a estante
  hold(s, 0.8, { f: 1, sprint: true, yaw: -Math.PI / 2 });
  stepPlayer(s, cmd({ f: 1, sprint: true, crouch: true, yaw: -Math.PI / 2 }));
  assert.ok(s.slide > 0, 'entrou em slide');
  assert.ok(Math.hypot(s.vx, s.vz) > 14, 'impulso do slide');
  assert.equal(eyeY(s), s.y + CROUCH_EYE);
});

test('mirar (ADS) desacelera para 60% e impede a corrida', () => {
  const free = newState(-25, 0, 13);
  hold(free, 1, { f: 1, yaw: -Math.PI / 2 });
  const ads = newState(-25, 0, 13.9);
  hold(ads, 1, { f: 1, sprint: true, ads: true, yaw: -Math.PI / 2 });
  const ratio = Math.hypot(ads.vx, ads.vz) / Math.hypot(free.vx, free.vz);
  assert.ok(Math.abs(ratio - 0.6) < 0.02, `razão ADS = ${ratio.toFixed(2)}`);
  assert.equal(ads.sprinting, false);
});

// Rotas de escalada desenhadas no mapa: cada degrau precisa ser alcançável pulando
const routes: { name: string; from: [number, number, number]; yaw: number; top: number }[] = [
  { name: 'chão → almofada do chão', from: [-6.5, 0, -8.2], yaw: 0, top: 1.6 },
  { name: 'almofada → assento do sofá', from: [-6.5, 1.6, -10.8], yaw: 0, top: 3.2 },
  { name: 'assento → almofada encostada', from: [-9.5, 3.2, -13.2], yaw: 0, top: 5.0 },
  { name: 'almofada encostada → topo do encosto (ninho de sniper)', from: [-9.5, 5.0, -15.8], yaw: 0, top: 6.5 },
  { name: 'caixa-degrau → tampo da mesa', from: [-8.5, 1.9, 0], yaw: -Math.PI / 2, top: 3.5 },
  { name: 'livros → prateleira da estante', from: [-10.2, 2.4, 17.5], yaw: -Math.PI / 2, top: 3.3 },
  { name: 'chão → plataforma 1 do arranhador', from: [-22.5, 0, -11.9], yaw: 0, top: 1.6 },
];

for (const r of routes) {
  test(`rota de escalada: ${r.name}`, () => {
    const s = newState(...r.from);
    hold(s, 0.1, {});
    assert.ok(Math.abs(s.y - r.from[1]) < 0.05, `apoiado no ponto de partida (y=${s.y.toFixed(2)})`);
    hold(s, 1.2, { f: 1, jump: true, yaw: r.yaw });
    hold(s, 0.3, { f: 1, yaw: r.yaw });
    assert.ok(s.y >= r.top - 0.05, `terminou em y=${s.y.toFixed(2)}, esperado ≥ ${r.top}`);
  });
}

// ── Shipment ────────────────────────────────────────────────────────────────

test('mapas: todos os spawns estão livres e há malha de navegação', () => {
  for (const id of MAP_ROTATION) {
    setMap(id);
    for (const sp of [...MAPS[id].spawns.orange, ...MAPS[id].spawns.black]) {
      assert.equal(collides(sp[0], sp[1] + 0.01, sp[2], STAND_H), null, `${id}: spawn ${sp} dentro de algo`);
    }
    assert.ok(navPoints().length > 40, `${id}: poucos pontos de navegação`);
  }
  setMap('sala');
});

const shipmentRoutes: typeof routes = [
  { name: 'chão → caixote-degrau (norte)', from: [-15, 0, -10], yaw: -Math.PI / 2, top: 1.4 },
  { name: 'caixote → topo do contêiner (norte)', from: [-13.3, 1.4, -10], yaw: -Math.PI / 2, top: 2.6 },
  { name: 'chão → caixote-degrau (sul)', from: [-3, 0, 10], yaw: Math.PI / 2, top: 1.4 },
  { name: 'caixote → topo do contêiner (sul)', from: [-4.7, 1.4, 10], yaw: Math.PI / 2, top: 2.6 },
];

for (const r of shipmentRoutes) {
  test(`Shipment — rota de escalada: ${r.name}`, () => {
    setMap('shipment');
    try {
      const s = newState(...r.from);
      hold(s, 0.1, {});
      assert.ok(Math.abs(s.y - r.from[1]) < 0.05, `apoiado no ponto de partida (y=${s.y.toFixed(2)})`);
      // Contêineres/caixotes são curtos: um pulo só, depois para (senão cai do outro lado)
      hold(s, 0.55, { f: 1, jump: true, yaw: r.yaw });
      hold(s, 0.6, { yaw: r.yaw });
      assert.ok(s.y >= r.top - 0.05, `terminou em y=${s.y.toFixed(2)}, esperado ≥ ${r.top}`);
    } finally { setMap('sala'); }
  });
}

test('Shipment — dá para atravessar os contêineres abertos (meio e laterais)', () => {
  setMap('shipment');
  try {
    const mid = newState(-6, 0, 0);
    hold(mid, 1.6, { f: 1, yaw: -Math.PI / 2 });
    assert.ok(mid.x > 4 && mid.y < 0.1, `parou em x=${mid.x.toFixed(2)} (meio)`);
    const side = newState(-9, 0, -6);
    hold(side, 1.6, { f: 1, yaw: Math.PI });
    assert.ok(side.z > 4 && side.y < 0.1, `parou em z=${side.z.toFixed(2)} (lateral)`);
  } finally { setMap('sala'); }
});
