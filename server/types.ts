// Tipos internos do servidor. O protocolo de rede fica em shared/types.ts
// (reexportado aqui para conveniência).

import type { WebSocket } from 'ws';
import type { InputCmd, PState } from '../shared/sim.ts';
import type { Skin, Team } from '../shared/types.ts';
import type { WeaponId } from '../shared/weapons.ts';

export type * from '../shared/types.ts';

export interface HistoryEntry {
  time: number;
  x: number; y: number; z: number;
  crouch: boolean;
  alive: boolean;
  yaw: number;
}

export interface BotBrain {
  skill: number; // 0..1
  targetId: number | null;
  lastSeen: { x: number; y: number; z: number; time: number } | null;
  waypoint: [number, number] | null;
  stuckTime: number;
  lastPos: [number, number];
  reactUntil: number; // não atira antes disso (tempo de reação)
  aimErrYaw: number;
  aimErrPitch: number;
  nextAimErr: number;
  strafe: number;
  strafeUntil: number;
  jumpUntil: number;
  crouchUntil: number;
  seq: number;
  hurtFrom: { x: number; z: number; time: number } | null;
}

export interface Player {
  id: number;
  name: string;
  team: Team;
  skin: Skin;
  isBot: boolean;
  ws: WebSocket | null;
  st: PState;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  respawnAt: number;
  invUntil: number;
  kills: number;
  deaths: number;
  weapon: WeaponId;
  ammo: number[];
  reloadUntil: number;
  reloadW: WeaponId;
  lastShot: number;
  burst: number; // tiros seguidos (bloom)
  streak: number; // abates sem morrer
  lastDamage: number;
  purring: boolean;
  queue: InputCmd[];
  ack: number;
  ping: number;
  history: HistoryEntry[];
  bot: BotBrain | null;
}
