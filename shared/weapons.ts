// Arsenal tático felino. Valores usados pelo servidor (autoridade) e pelo cliente (feedback).

export type WeaponId = 0 | 1 | 2 | 3;

export interface WeaponDef {
  id: WeaponId;
  name: string;
  short: string;
  damage: number;
  headMult: number;
  interval: number; // segundos entre disparos
  mag: number;
  reload: number; // segundos
  pellets: number;
  spreadHip: number; // radianos
  spreadAds: number;
  range: number;
  falloffStart: number;
  auto: boolean;
  adsFov: number;
  recoil: number; // radianos de subida da mira por tiro
  melee?: boolean;
}

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 0, name: 'Meow-4A1', short: 'M4A1', damage: 24, headMult: 1.6, interval: 0.1, mag: 30, reload: 2.0,
    pellets: 1, spreadHip: 0.022, spreadAds: 0.004, range: 120, falloffStart: 40, auto: true, adsFov: 55, recoil: 0.012,
  },
  {
    id: 1, name: 'Purr-Pump', short: 'PUMP', damage: 14, headMult: 1.3, interval: 0.85, mag: 6, reload: 2.6,
    pellets: 8, spreadHip: 0.075, spreadAds: 0.055, range: 40, falloffStart: 8, auto: false, adsFov: 62, recoil: 0.06,
  },
  {
    id: 2, name: 'Cat-98k', short: '98K', damage: 95, headMult: 2.0, interval: 1.25, mag: 5, reload: 3.0,
    pellets: 1, spreadHip: 0.06, spreadAds: 0, range: 200, falloffStart: 200, auto: false, adsFov: 18, recoil: 0.08,
  },
  {
    id: 3, name: 'Patada Tática', short: 'PATA', damage: 60, headMult: 1.0, interval: 0.55, mag: Infinity, reload: 0,
    pellets: 1, spreadHip: 0, spreadAds: 0, range: 2.0, falloffStart: 2.0, auto: false, adsFov: 75, recoil: 0, melee: true,
  },
];

export const MAX_HP = 100;

export interface SpreadState {
  ads: boolean;
  speed: number; // velocidade horizontal (u/s)
  onGround: boolean;
  burst: number; // tiros seguidos na rajada atual (0 = primeiro tiro)
}

/**
 * Dispersão efetiva (radianos), igual no servidor e na mira do cliente:
 * - imprecisão por movimento (como no CS): correndo, o tiro abre; parado é preciso;
 * - no ar a precisão despenca;
 * - bloom: tiros seguidos abrem a dispersão do fuzil; o 1º tiro é sempre preciso.
 */
export function spreadFor(w: WeaponDef, s: SpreadState): number {
  if (w.melee) return 0;
  const move = Math.min(1, s.speed / 11.5);
  let spread = s.ads ? w.spreadAds : w.spreadHip;
  if (w.id === 2) spread += move * (s.ads ? 0.09 : 0.05); // sniper exige parar
  else spread += move * (s.ads ? 0.018 : 0.035);
  if (!s.onGround) spread += 0.06;
  if (w.auto) spread += Math.min(s.burst, 10) * (s.ads ? 0.0015 : 0.004);
  return spread;
}

/** Tempo (s) sem atirar que zera a contagem de tiros seguidos. */
export function burstReset(w: WeaponDef): number {
  return w.interval * 2.5;
}

/**
 * Padrão de recuo fixo do Meow-4A1 (radianos de desvio lateral por tiro), no
 * estilo do spray do CS: sobe reto, puxa para a direita e depois para a esquerda.
 */
export const RIFLE_SPRAY_YAW = [0, 0, 0.002, 0.004, 0.006, 0.006, 0.003, -0.002, -0.006, -0.008, -0.007, -0.003, 0.002, 0.006, 0.008];


/** Dano após queda por distância (mínimo 45% do base). */
export function damageAt(w: WeaponDef, dist: number): number {
  if (dist <= w.falloffStart) return w.damage;
  const t = Math.min(1, (dist - w.falloffStart) / Math.max(1, w.range - w.falloffStart));
  return w.damage * (1 - 0.55 * t);
}
