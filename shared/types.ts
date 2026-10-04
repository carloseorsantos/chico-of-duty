// Protocolo de rede (JSON sobre WebSocket) compartilhado entre cliente e servidor.

import type { InputCmd, PState } from './sim.ts';
import type { MapId } from './map.ts';
import type { WeaponId } from './weapons.ts';

export type Team = 'orange' | 'black';
export type Skin = 'laranja' | 'preto' | 'rajado' | 'siames';

export const TICK_RATE = 30;
export const SCORE_LIMIT = 25;
export const MATCH_SECONDS = 600;
export const RESPAWN_SECONDS = 3;
export const SPAWN_PROTECT = 1.5;
export const TEAM_SIZE = 4; // bots preenchem até 4v4
export const UAV_STREAK = 3; // abates seguidos para o Drone Pombo
export const UAV_SECONDS = 12;
export const AIRSTRIKE_STREAK = 5; // abates seguidos para o Bombardeio de Pombos

export const RADIO_LINES = [
  'Bravo Six, going meow.',
  'Contato! Gato inimigo à vista!',
  'Preciso de cobertura, miau!',
  'Área limpa. Hora da soneca.',
  'Na caixa! Todos na caixa!',
  'Recuar para o sofá!',
] as const;

// ── Cliente → Servidor ────────────────────────────────────────────────────
export type ClientMsg =
  | { t: 'join'; name: string; skin: Skin; team: Team | 'auto' }
  | { t: 'input'; cmds: InputCmd[] }
  | { t: 'shoot'; w: WeaponId; dx: number; dy: number; dz: number; ads: boolean; rt: number }
  | { t: 'reload'; w: WeaponId }
  | { t: 'switch'; w: WeaponId }
  | { t: 'radio'; id: number }
  | { t: 'ping'; c: number }
  | { t: 'airstrike'; x: number; z: number };

// ── Servidor → Cliente ────────────────────────────────────────────────────
export interface NetPlayer {
  id: number;
  n: string; // nick
  tm: Team;
  sk: Skin;
  x: number; y: number; z: number;
  yw: number; pt: number;
  hp: number;
  cr: boolean; // agachado/deslizando
  sl: boolean; // deslizando
  w: WeaponId;
  a: boolean; // vivo
  bot: boolean;
  k: number; d: number;
  inv: boolean; // proteção de spawn
  pu: boolean; // ronronando (curando)
  pg: number; // ping
  st: number; // abates seguidos nesta vida
}

export interface MeState {
  ack: number; // último seq de input processado
  st: PState;
  ammo: number[];
  respawnIn: number;
  as: number; // bombardeios disponíveis
}

export type ServerMsg =
  | { t: 'welcome'; id: number; team: Team; map: MapId }
  | {
      t: 'snap';
      time: number;
      players: NetPlayer[];
      score: Record<Team, number>;
      timeLeft: number;
      uav: Record<Team, number>; // segundos restantes do Drone Pombo por time
      phase: 'playing' | 'ended';
      me?: MeState;
    }
  | { t: 'shot'; id: number; w: WeaponId; o: number[]; ends: number[][] }
  | { t: 'hit'; head: boolean; kill: boolean; dmg: number }
  | { t: 'dmg'; fx: number; fz: number; hp: number }
  | { t: 'kill'; killer: number; victim: number; w: WeaponId; head: boolean; kn: string; vn: string; kt: Team; vt: Team; kh: number; dist: number }
  | { t: 'streak'; id: number; name: string; team: Team; kind: 'uav' | 'airstrike'; seconds: number }
  | { t: 'airstrike'; id: number; name: string; team: Team; points: [number, number, number, number][]; dir: [number, number] }
  | { t: 'radio'; from: string; team: Team; id: number }
  | { t: 'end'; winner: Team | 'draw'; nextIn: number; mvp: { name: string; team: Team; k: number; d: number } | null }
  | { t: 'start'; map: MapId }
  | { t: 'pong'; c: number }
  | { t: 'info'; msg: string };
