// Chico of Duty — cliente. Inicializa o Three.js, o lobby, a rede e o loop de jogo:
// predição local do movimento (a 60 Hz) + reconciliação com o servidor autoritário.

import * as THREE from 'three';
import { copyState, eyeY, newState, rayWorld, rayWorldHit, stepPlayer, type InputCmd, type PState } from '../../shared/sim.ts';
import { RADIO_LINES, type NetPlayer, type ServerMsg, type Skin, type Team } from '../../shared/types.ts';
import { MAX_HP, WEAPONS } from '../../shared/weapons.ts';
import { AirstrikeFx, loadPigeon } from './Airstrike.ts';
import { audio, WEAPON_SFX } from './Audio.ts';
import { CatModel, FUR, TEAM_ACCENT } from './CatModel.ts';
import { Effects } from './Effects.ts';
import { loadCatAsset } from './CatAsset.ts';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { HUD } from './HUD.ts';
import { Input } from './Input.ts';
import { buildMap, type BuiltMap } from './MapBuilder.ts';
import { MAP, MAPS, setMap, type MapId } from '../../shared/map.ts';
import { Network } from './Network.ts';
import { StrikeMap } from './StrikeMap.ts';
import { Viewmodel } from './Viewmodel.ts';
import { WeaponManager } from './WeaponManager.ts';

const FIXED_DT = 1 / 60;
let baseFov = 78; // ajustável nas opções (FOV)

// ── Renderização ─────────────────────────────────────────────────────────
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.autoClear = false;
renderer.info.autoReset = false; // somamos mundo + viewmodel por frame

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(baseFov, 1, 0.05, 300);
camera.rotation.order = 'YXZ';
scene.add(camera);
let world: BuiltMap = buildMap(scene, MAP);
// O mapa é estático: a sombra do sol é renderizada uma única vez (os gatos usam
// sombra-blob). Economiza um passe inteiro de sombra por frame.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

/** Troca o mapa (o servidor avisa no welcome e a cada nova partida). */
function switchMap(id: MapId): void {
  if (!MAPS[id] || MAP.id === id) return;
  world.dispose();
  setMap(id);
  world = buildMap(scene, MAP);
  renderer.shadowMap.needsUpdate = true;
  fx.clearDecals();
  airFx.clear();
}

// Assets externos (CC0): gato animado e HDRI de sala de estar para luz/reflexos
// O botão "Entrar" só libera quando o gato e o HDRI carregaram (ou após 8 s, com
// os substitutos procedurais), para ninguém entrar com a sala sem luz/gatos genéricos.
const catReady = loadCatAsset().catch((err) => console.warn('Gato GLB indisponível, usando o procedural:', err));
const pmrem = new THREE.PMREMGenerator(renderer);
const hdrReady = new HDRLoader().loadAsync('/tex/lebombo_1k.hdr').then((hdr) => {
  const env = pmrem.fromEquirectangular(hdr).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.45;
  vm.scene.environment = env;
  vm.scene.environmentIntensity = 0.6;
  hdr.dispose();
}).catch((err) => console.warn('HDRI indisponível:', err));
const assetsReady = Promise.race([
  Promise.all([catReady, hdrReady]),
  new Promise((r) => setTimeout(r, 8000)),
]);


const vm = new Viewmodel();
const input = new Input(canvas);
const net = new Network();
const weapons = new WeaponManager(net, vm, input);
const hud = new HUD();

function resize(): void {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  vm.camera.aspect = w / h;
  vm.camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ── Estado do jogo ───────────────────────────────────────────────────────
let myId = -1;
let myTeam: Team = 'orange';
let mySkin: Skin = 'laranja';
let inGame = false;
let alive = false;
let hp = MAX_HP;
let purring = false;
let pred: PState = newState(0, 0, 0);
const prevPos = new THREE.Vector3();
const smoothOffset = new THREE.Vector3();
let pending: InputCmd[] = [];
let outbox: InputCmd[] = [];
let seq = 0;
let acc = 0;
let eyeSmooth = 0.62;
let uavLeft: Record<Team, number> = { orange: 0, black: 0 };
let score: Record<Team, number> = { orange: 0, black: 0 };
let timeLeft = 600;
let phase: 'playing' | 'ended' = 'playing';
let latestPlayers: NetPlayer[] = [];
let respawnIn = 0;
let airstrikes = 0; // bombardeios guardados (killstreak de 5 abates)
let killerId: number | null = null;
const deathPos = new THREE.Vector3();
let deathBy = '';
let radioOpen = false;
let stepDist = 0;
let wasOnGround = true;
let wasSliding = false;
const noisy = new Map<number, number>();
const cats = new Map<number, CatModel>();
const catState = new Map<number, { stepPhase: number; fur: number }>();

// ── Efeitos de tiro ──────────────────────────────────────────────────────
const fx = new Effects(scene);
let shake = 0; // tremida de câmera ao atirar
const clawEl = document.getElementById('claw')!;

// ── Bombardeio de Pombos ─────────────────────────────────────────────────
void loadPigeon().catch((err) => console.warn('Pombo GLB indisponível, usando o procedural:', err));
const airFx = new AirstrikeFx(scene, fx, (pos) => {
  // Explosão perto treme a câmera
  const d = camera.position.distanceTo(pos);
  if (d < 14) shake = Math.max(shake, 1.8 * (1 - d / 14));
});
const strikeMap = new StrikeMap();
let strikeRightHeld = false; // botão direito já estava apertado (ADS) ao abrir o mapa

function setStrikeMap(on: boolean): void {
  if (on === strikeMap.open) return;
  strikeMap.show(on, { x: pred.x + (myTeam === 'orange' ? 12 : -12), z: pred.z });
  input.cursorMode = on;
  input.cursorDX = input.cursorDY = 0;
  input.clicks = 0;
  strikeRightHeld = input.rightDown;
  if (on) audio.play('radio', { volume: 0.6 });
}

// ── Lobby ────────────────────────────────────────────────────────────────
const lobby = document.getElementById('lobby')!;
const pauseEl = document.getElementById('pause')!;
const nickEl = document.getElementById('nick') as HTMLInputElement;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const lobbyErr = document.getElementById('lobby-error')!;
let teamPref: Team | 'auto' = 'auto';

try {
  nickEl.value = localStorage.getItem('cod-nick') ?? '';
  const s = localStorage.getItem('cod-skin') as Skin | null;
  if (s) mySkin = s;
} catch { /* armazenamento indisponível */ }

function selectIn(containerId: string, attr: string, value: string): void {
  for (const b of document.querySelectorAll<HTMLElement>(`#${containerId} button`)) b.classList.toggle('active', b.dataset[attr] === value);
}
selectIn('skins', 'skin', mySkin);
document.getElementById('skins')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  mySkin = b.dataset.skin as Skin;
  selectIn('skins', 'skin', mySkin);
});
document.getElementById('teams')!.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  teamPref = b.dataset.team as Team | 'auto';
  selectIn('teams', 'team', teamPref);
});

playBtn.addEventListener('click', async () => {
  audio.init();
  playBtn.disabled = true;
  lobbyErr.textContent = '';
  const name = nickEl.value.trim() || `Recruta ${Math.floor(Math.random() * 900 + 100)}`;
  try { localStorage.setItem('cod-nick', name); localStorage.setItem('cod-skin', mySkin); } catch { /* ignora */ }
  try {
    if (!net.connected) await net.connect();
    net.send({ t: 'join', name, skin: mySkin, team: teamPref });
    vm.setSkin(mySkin);
    input.lock();
  } catch (err) {
    lobbyErr.textContent = `${(err as Error).message}. O servidor (npm run server) está rodando?`;
    playBtn.disabled = false;
  }
});
nickEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !playBtn.disabled) playBtn.click(); });
playBtn.disabled = true;
playBtn.textContent = 'CARREGANDO…';
void assetsReady.then(() => {
  playBtn.disabled = false;
  playBtn.textContent = 'ENTRAR NA PARTIDA';
});

document.getElementById('resume')!.addEventListener('click', () => { audio.init(); input.lock(); });
const sensEl = document.getElementById('sens') as HTMLInputElement;
const volEl = document.getElementById('vol') as HTMLInputElement;
const fovEl = document.getElementById('fov') as HTMLInputElement;
const fovVal = document.getElementById('fov-val')!;
try {
  sensEl.value = localStorage.getItem('cod-sens') ?? '1';
  volEl.value = localStorage.getItem('cod-vol') ?? '0.7';
  fovEl.value = localStorage.getItem('cod-fov') ?? '78';
} catch { /* ignora */ }
const applySettings = () => {
  input.sensitivity = 0.0022 * Number(sensEl.value);
  baseFov = Number(fovEl.value);
  fovVal.textContent = fovEl.value;
  audio.setVolume(Number(volEl.value));
  try { localStorage.setItem('cod-sens', sensEl.value); localStorage.setItem('cod-vol', volEl.value); localStorage.setItem('cod-fov', fovEl.value); } catch { /* ignora */ }
};
sensEl.addEventListener('input', applySettings);
volEl.addEventListener('input', applySettings);
fovEl.addEventListener('input', applySettings);
applySettings();
canvas.addEventListener('click', () => { if (inGame && !input.locked) input.lock(); });

document.addEventListener('pointerlockchange', () => {
  pauseEl.classList.toggle('hidden', !inGame || input.locked);
});

net.onClose = () => {
  inGame = false;
  hud.show(false);
  lobby.classList.remove('hidden');
  pauseEl.classList.add('hidden');
  playBtn.disabled = false;
  lobbyErr.textContent = 'Conexão com o servidor perdida.';
  document.exitPointerLock?.();
};

// ── Mensagens do servidor ────────────────────────────────────────────────
net.onMessage = (msg: ServerMsg) => {
  switch (msg.t) {
    case 'welcome':
      myId = msg.id;
      myTeam = msg.team;
      switchMap(msg.map);
      inGame = true;
      lobby.classList.add('hidden');
      hud.show(true);
      hud.center('TEAM DEATHMATCH', `${MAP.name} · Esquadrão ${myTeam === 'orange' ? 'Laranja' : 'Preto'} · 25 abates`, 3000);
      setTimeout(() => { audio.radio(0); hud.radio('QG', 0); }, 800);
      break;
    case 'snap':
      onSnapshot(msg);
      break;
    case 'shot': {
      noisy.set(msg.id, performance.now());
      const o = new THREE.Vector3(msg.o[0], msg.o[1], msg.o[2]);
      const sfx = WEAPON_SFX[msg.w];
      if (sfx) audio.play(sfx, { pos: { x: o.x, y: o.y, z: o.z }, volume: 0.9 });
      // O gato que atirou mostra clarão e recuo; traçantes saem do cano dele
      const shooter = cats.get(msg.id);
      shooter?.fire(msg.w);
      const muzzle = shooter ? shooter.muzzleWorld(new THREE.Vector3()) : o.clone();
      if (msg.w !== 3) fx.flashLight(muzzle, 14);
      for (const e of msg.ends) {
        const end = new THREE.Vector3(e[0], e[1], e[2]);
        const dir = end.clone().sub(o).normalize();
        fx.tracer(muzzle, end, 0xffd28a);
        const hit = rayWorldHit(o.x, o.y, o.z, dir.x, dir.y, dir.z, o.distanceTo(end) + 0.2);
        if (hit.normal && Math.abs(hit.dist - o.distanceTo(end)) < 0.3) {
          fx.impact(end, new THREE.Vector3(...hit.normal), msg.w === 1 ? 0 : 1);
        } else {
          fx.furHit(end, 0xffffff); // parou num gato
        }
      }
      break;
    }
    case 'hit':
      hud.hitmarker(msg.head, msg.kill);
      audio.play(msg.head ? 'headshot' : 'hit', { volume: 0.8 });
      if (msg.kill) setTimeout(() => audio.play('kill'), 90);
      break;
    case 'dmg':
      hud.damage(msg.fx, msg.fz, pred.x, pred.z);
      audio.play('hurt', { volume: 0.7 });
      hp = msg.hp;
      break;
    case 'kill': {
      hud.killfeed(msg, msg.killer === myId || msg.victim === myId);
      if (msg.victim === myId) {
        killerId = msg.killer;
        deathPos.set(pred.x, eyeY(pred), pred.z);
        const col = TEAM_ACCENT[msg.kt];
        deathBy = `Abatido por <b style="color:${col}">${escapeHtml(msg.kn)}</b> · ${WEAPONS[msg.w].name}${msg.head ? ' · 🎯 tiro na cabeça' : ''}`
          + `<div class="recap">${escapeHtml(msg.kn)} ficou com <b>${msg.kh}</b> de vida · distância ${msg.dist} m</div>`;
        audio.play('death');
      } else if (msg.killer === myId) {
        hud.center(msg.head ? 'TIRO NA CABEÇA' : 'ABATE CONFIRMADO', msg.vn, 1500);
      }
      const victimCat = cats.get(msg.victim);
      if (victimCat && msg.victim !== myId) audio.play('death', { pos: victimCat.root.position, volume: 0.6 });
      break;
    }
    case 'radio':
      hud.radio(msg.from, msg.id);
      audio.radio(msg.id);
      break;
    case 'streak':
      if (msg.kind === 'airstrike') {
        // Bombardeio guardado: só o dono é avisado (o aviso geral vem quando ele chama)
        if (msg.id !== myId) break;
        hud.center('KILLSTREAK: BOMBARDEIO DE POMBOS', 'Aperte 4 para escolher o alvo', 3000);
        audio.play('coo');
      } else if (msg.id === myId) hud.center('KILLSTREAK: DRONE POMBO', `Inimigos revelados no radar por ${msg.seconds}s`, 2500);
      else if (msg.team === myTeam) hud.center('DRONE POMBO NO AR', `${msg.name} revelou os inimigos`, 2200);
      else hud.center('DRONE INIMIGO!', 'Você aparece no radar deles — mova-se!', 2200);
      audio.play('radio');
      break;
    case 'airstrike':
      airFx.start(msg, myTeam);
      if (msg.id === myId) hud.center('BOMBARDEIO A CAMINHO', 'O bando está chegando. Bravo Six, going coo.', 2500);
      else if (msg.team === myTeam) hud.center('BOMBARDEIO ALIADO', `${msg.name} chamou o bando — fique longe do verde`, 2500);
      else hud.center('BOMBARDEIO INIMIGO!', 'Saia da área vermelha!', 3000);
      audio.play('radio');
      break;
    case 'end':
      phase = 'ended';
      hud.setEnd(true, msg.winner, myTeam, msg.nextIn, msg.mvp);
      audio.play(msg.winner === myTeam ? 'win' : 'lose');
      break;
    case 'start':
      phase = 'playing';
      switchMap(msg.map);
      airFx.clear();
      setStrikeMap(false);
      hud.setEnd(false);
      hud.center('NOVA PARTIDA', `${MAP.name} · Bravo Six, going meow.`, 2500);
      audio.radio(0);
      break;
    case 'info':
      hud.toast(msg.msg);
      break;
  }
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function onSnapshot(msg: Extract<ServerMsg, { t: 'snap' }>): void {
  latestPlayers = msg.players;
  uavLeft = msg.uav;
  score = msg.score;
  timeLeft = msg.timeLeft;
  phase = msg.phase;
  const self = msg.players.find((p) => p.id === myId);
  if (!self || !msg.me) return;
  const me = msg.me;
  respawnIn = me.respawnIn;
  airstrikes = me.as ?? 0;
  hp = self.hp;
  purring = self.pu;
  myTeam = self.tm;

  if (self.a && !alive) {
    // Reapareceu
    alive = true;
    pred = copyState(me.st);
    prevPos.set(pred.x, pred.y, pred.z);
    smoothOffset.set(0, 0, 0);
    pending = [];
    input.yaw = myTeam === 'orange' ? -Math.PI / 2 : Math.PI / 2;
    input.pitch = 0;
    weapons.reset();
    killerId = null;
    hud.setDeath(false);
    audio.play('spawn', { volume: 0.6 });
    return;
  }
  if (!self.a) {
    alive = false;
    return;
  }

  // Reconciliação: parte do estado do servidor e reaplica os inputs pendentes
  pending = pending.filter((c) => c.seq > me.ack);
  const before = new THREE.Vector3(pred.x, pred.y, pred.z);
  const fresh = copyState(me.st);
  for (const c of pending) stepPlayer(fresh, c);
  const err = before.clone().sub(new THREE.Vector3(fresh.x, fresh.y, fresh.z));
  if (err.length() > 3) smoothOffset.set(0, 0, 0);
  else smoothOffset.add(err);
  pred = fresh;
}

// ── Loop ─────────────────────────────────────────────────────────────────
let last = performance.now();

function fixedTick(): void {
  prevPos.set(pred.x, pred.y, pred.z);
  if (!alive) return;
  const canMove = input.locked ? 1 : 0;
  const mv = input.move();
  // Mirar (ADS) desacelera o gato — simulado igual no servidor
  const adsWanted = input.rightDown && !weapons.def.melee && !weapons.reloading;
  const cmd: InputCmd = {
    seq: ++seq, dt: FIXED_DT,
    f: mv.f * canMove, s: mv.s * canMove,
    jump: canMove > 0 && input.down('Space'),
    sprint: canMove > 0 && (input.down('ShiftLeft') || input.down('ShiftRight')) && !adsWanted,
    crouch: canMove > 0 && (input.down('KeyC') || input.down('ControlLeft')),
    yaw: input.yaw, pitch: input.pitch,
    ads: canMove > 0 && adsWanted,
  };
  const wasGround = pred.onGround;
  stepPlayer(pred, cmd);
  if (cmd.jump && wasGround && !pred.onGround && pred.vy > 0) audio.play('jump', { volume: 0.5 });
  pending.push(cmd);
  outbox.push(cmd);
  if (pending.length > 240) pending.shift();
}

function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const time = now / 1000;

  if (inGame) {
    // Rádio tático (Z abre o menu; 1–6 envia)
    if (input.consume('KeyZ')) { radioOpen = !radioOpen; hud.setRadioMenu(radioOpen); }
    if (radioOpen) {
      for (let i = 0; i < RADIO_LINES.length; i++) {
        if (input.consume(`Digit${i + 1}`)) {
          net.send({ t: 'radio', id: i });
          radioOpen = false;
          hud.setRadioMenu(false);
        }
      }
    }

    acc += dt;
    while (acc >= FIXED_DT) { fixedTick(); acc -= FIXED_DT; }
    if (outbox.length) { net.send({ t: 'input', cmds: outbox }); outbox = []; }
    input.update(dt);

    smoothOffset.multiplyScalar(Math.pow(0.0001, dt));
    const alpha = acc / FIXED_DT;
    const px = prevPos.x + (pred.x - prevPos.x) * alpha + smoothOffset.x;
    const py = prevPos.y + (pred.y - prevPos.y) * alpha + smoothOffset.y;
    const pz = prevPos.z + (pred.z - prevPos.z) * alpha + smoothOffset.z;
    const speed = Math.hypot(pred.vx, pred.vz);

    if (alive) {
      const targetEye = eyeY(pred) - pred.y;
      eyeSmooth += (targetEye - eyeSmooth) * Math.min(1, dt * 14);
      camera.position.set(px, py + eyeSmooth, pz);
      shake = Math.max(0, shake - dt * 9);
      const sh = shake * shake;
      camera.rotation.set(
        input.pitch + (Math.random() - 0.5) * 0.012 * sh,
        input.yaw + (Math.random() - 0.5) * 0.012 * sh,
        (pred.slide > 0 ? 0.06 : 0) + (Math.random() - 0.5) * 0.02 * sh,
      );

      // Passos, aterrissagem e slide
      if (pred.onGround && speed > 1.5 && !(pred.crouch && speed < 4)) {
        stepDist += speed * dt;
        if (stepDist > (pred.sprinting ? 2.6 : 2.0)) { stepDist = 0; audio.play('step', { volume: pred.sprinting ? 0.7 : 0.5 }); }
      }
      if (pred.onGround && !wasOnGround) { audio.play('land', { volume: 0.5 }); vm.onLand(); }
      if (pred.slide > 0 && !wasSliding) audio.play('slide', { volume: 0.7 });
      wasOnGround = pred.onGround;
      wasSliding = pred.slide > 0;

      // Bombardeio: 4 abre o mapa de alvo; clique confirma; 4 / botão direito cancela
      if (input.consume('Digit4') && !radioOpen) {
        if (strikeMap.open) setStrikeMap(false);
        else if (airstrikes > 0 && phase === 'playing') setStrikeMap(true);
        else hud.toast('Bombardeio de Pombos: 5 abates seguidos sem morrer');
      }
      if (strikeMap.open) {
        strikeMap.moveCursor(input.cursorDX, input.cursorDY);
        input.cursorDX = input.cursorDY = 0;
        if (!input.rightDown) strikeRightHeld = false;
        if ((input.rightDown && !strikeRightHeld) || phase !== 'playing' || airstrikes <= 0 || !input.locked) setStrikeMap(false);
        else if (input.clicks > 0) {
          net.send({ t: 'airstrike', x: Math.round(strikeMap.x * 100) / 100, z: Math.round(strikeMap.z * 100) / 100 });
          airstrikes--;
          setStrikeMap(false);
        }
        strikeMap.draw({ me: { x: pred.x, z: pred.z, yaw: input.yaw, team: myTeam, id: myId }, players: latestPlayers, noisy, now, uav: uavLeft[myTeam] });
      }

      // Armas
      const canAct = input.locked && !radioOpen && !strikeMap.open && phase === 'playing';
      const shot = weapons.update(camera, canAct, speed, pred.onGround, pred.sprinting && speed > 8);
      if (shot) onLocalShot(shot.dirs, shot.weapon.melee === true);
      const adsTarget = input.rightDown && !pred.sprinting && !weapons.def.melee && !weapons.reloading ? 1 : 0;
      vm.update(dt, { speed, onGround: pred.onGround, adsTarget, sprinting: pred.sprinting && speed > 8, sliding: pred.slide > 0, crouch: pred.crouch, time });

      const targetFov = baseFov + (WEAPONS[weapons.current].adsFov - baseFov) * vm.ads + (pred.sprinting && speed > 8 ? 6 : 0);
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
      camera.updateProjectionMatrix();
      input.sensScale = camera.fov / baseFov;
      hud.setDeath(false);
    } else {
      // Câmera de morte: sobe devagar e olha para quem te abateu
      const killer = killerId !== null ? cats.get(killerId) : null;
      camera.position.lerp(deathPos.clone().add(new THREE.Vector3(0, 2.2, 0)), Math.min(1, dt * 1.5));
      if (killer) camera.lookAt(killer.root.position.clone().add(new THREE.Vector3(0, 0.8, 0)));
      camera.fov += (baseFov - camera.fov) * Math.min(1, dt * 8);
      camera.updateProjectionMatrix();
      hud.setDeath(true, deathBy, respawnIn);
      vm.ads = 0;
      setStrikeMap(false);
    }

    audio.listener = { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: input.yaw };
    audio.setPurring(alive && purring);
    updateRemotes(dt, time);

    const d = weapons.def;
    const spread = weapons.currentSpread(vm.ads > 0.6, Math.hypot(pred.vx, pred.vz), pred.onGround);
    hud.update({
      hp: alive ? hp : 0, stamina: pred.stamina, purring: alive && purring, weapon: weapons.current,
      ammo: weapons.ammo[weapons.current], reloading: weapons.reloading, yaw: input.yaw, score, timeLeft,
      ads: vm.ads, spread: d.melee ? 0 : spread, me: { x: pred.x, z: pred.z, team: myTeam, id: myId },
      players: latestPlayers, noisy, now, uav: uavLeft[myTeam], airstrikes,
    });
    hud.setScoreboard(input.down('Tab') || phase === 'ended', latestPlayers, score, myId);
  } else {
    // Câmera de menu: passeio lento pela sala
    const t = time * 0.08;
    camera.position.set(Math.sin(t) * 18, 7 + Math.sin(t * 2) * 1.5, Math.cos(t) * 12);
    camera.lookAt(0, 3, 0);
    updateRemotes(dt, time);
  }

  airFx.update(dt, now);
  fx.update(dt);
  renderer.info.reset();
  renderer.clear();
  renderer.render(scene, camera);
  if (inGame && alive) {
    renderer.clearDepth();
    renderer.render(vm.scene, vm.camera);
  }
}

const tmpV = new THREE.Vector3();
function onLocalShot(dirs: THREE.Vector3[], melee: boolean): void {
  if (melee) {
    // Marcas de garra na tela
    clawEl.classList.remove('show');
    void clawEl.offsetWidth;
    clawEl.classList.add('show');
    shake = 0.6;
    return;
  }
  const w = weapons.current;
  shake = w === 0 ? 0.55 : w === 1 ? 1 : 1.2;
  const origin = camera.position.clone();
  const muzzle = vm.muzzleWorld(camera, tmpV.clone());
  fx.flashLight(muzzle, w === 0 ? 16 : 26);
  for (const dir of dirs) {
    const hit = rayWorldHit(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, weapons.def.range);
    let dist = hit.dist;
    let catHit: number | null = null;
    // Traçante para no primeiro gato atingido (aproximação visual)
    for (const [id, cat] of cats) {
      if (id === myId || !cat.root.visible) continue;
      const c = cat.root.position.clone().add(new THREE.Vector3(0, 0.6, 0));
      const t = c.clone().sub(origin).dot(dir);
      if (t > 0 && t < dist && origin.clone().addScaledVector(dir, t).distanceTo(c) < 0.45) { dist = t; catHit = id; }
    }
    const end = origin.clone().addScaledVector(dir, dist);
    fx.tracer(muzzle, end);
    if (catHit !== null) fx.furHit(end, catState.get(catHit)?.fur ?? 0xffffff);
    else if (hit.normal && dist < weapons.def.range - 0.01) fx.impact(end, new THREE.Vector3(...hit.normal), w === 1 ? 0 : 1);
  }
}

function updateRemotes(dt: number, time: number): void {
  const list = net.interpolated();
  const seen = new Set<number>();
  const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  for (const p of list) {
    if (p.id === myId) continue;
    seen.add(p.id);
    let cat = cats.get(p.id);
    if (!cat) {
      const ally = p.tm === myTeam;
      cat = new CatModel(p.sk, p.tm, p.n, ally ? TEAM_ACCENT[p.tm] : '#ff5a5a');
      cats.set(p.id, cat);
      catState.set(p.id, { stepPhase: 0, fur: FUR[p.sk].base });
      scene.add(cat.root);
    }
    cat.root.position.set(p.x, p.y, p.z);
    cat.root.rotation.y = p.yw;
    cat.setWeapon(p.w);
    cat.update(dt, { speed: p.speed, pitch: p.pt, crouch: p.cr, slide: p.sl, alive: p.a, inv: p.inv, time });

    // Nome: aliados sempre; inimigos só quando na mira e visíveis
    if (p.a) {
      const ally = p.tm === myTeam;
      const head = new THREE.Vector3(p.x, p.y + 1.0, p.z);
      const to = head.clone().sub(camera.position);
      const dist = to.length();
      let show = ally;
      if (!ally && inGame && dist < 70 && to.normalize().angleTo(camFwd) < 0.05) {
        show = rayWorld(camera.position.x, camera.position.y, camera.position.z, to.x, to.y, to.z, dist) >= dist - 0.1;
      }
      cat.label.visible = show;
    }

    // Passinhos dos outros gatos
    const st = catState.get(p.id)!;
    if (p.a && p.speed > 2) {
      st.stepPhase += p.speed * dt;
      if (st.stepPhase > 2.2) { st.stepPhase = 0; audio.play('step', { pos: { x: p.x, y: p.y, z: p.z }, volume: 0.6 }); }
    }
  }
  for (const [id, cat] of cats) {
    if (!seen.has(id)) { scene.remove(cat.root); cats.delete(id); catState.delete(id); }
  }
}

requestAnimationFrame(frame);

// Acesso para depuração no console (somente em desenvolvimento)
// Métricas de desempenho em data-stats (só com ?debug), para medir otimizações
let statFrames = 0;
if (new URLSearchParams(location.search).has('debug')) {
  const countFrame = () => { statFrames++; requestAnimationFrame(countFrame); };
  requestAnimationFrame(countFrame);
  setInterval(() => {
    const i = renderer.info;
    let objs = 0;
    scene.traverse(() => { objs++; });
    document.body.dataset.stats = JSON.stringify({
      fps: statFrames, calls: i.render.calls, tris: i.render.triangles,
      geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0, sceneObjects: objs,
    });
    statFrames = 0;
  }, 1000);
}

if (import.meta.env.DEV) Object.assign(window, { __cod: { input, weapons, vm, net, hud, get pred() { return pred; }, get alive() { return alive; }, get hp() { return hp; } } });
