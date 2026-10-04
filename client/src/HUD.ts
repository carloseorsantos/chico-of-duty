// HUD militar felino: bússola, radar, placar, killfeed, rádio, vida, Zoomies,
// munição, hitmarker, indicador de dano, tela de morte e placar TAB.

import { RADIO_LINES, type NetPlayer, type Team } from '../../shared/types.ts';
import { MAX_HP, WEAPONS, type WeaponId } from '../../shared/weapons.ts';
import { STAMINA_MAX } from '../../shared/sim.ts';
import { TEAM_ACCENT, TEAM_NAME } from './CatModel.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class HUD {
  private el = {
    hud: $('hud'), hpFill: $('hp-fill'), hpText: $('hp-text'), zoomFill: $('zoom-fill'), purr: $('purr'),
    weaponName: $('weapon-name'), ammo: $('ammo'), ammoMax: $('ammo-max'), reloadHint: $('reload-hint'),
    slots: $('weapon-slots'), scoreO: $('score-orange'), scoreB: $('score-black'), timer: $('timer'),
    killfeed: $('killfeed'), radioFeed: $('radio-feed'), toasts: $('toasts'), center: $('center-msg'),
    hit: $('hitmarker'), vignette: $('damage-vignette'), dmgDir: $('dmg-dir'), crosshair: $('crosshair'),
    scope: $('scope'), death: $('death'), deathBy: $('death-by'), deathTimer: $('death-timer'),
    scoreboard: $('scoreboard'), radioMenu: $('radio-menu'), end: $('end-screen'), endTitle: $('end-title'), endSub: $('end-sub'),
    compassStrip: $('compass-strip'), uav: $('uav'), uavTime: $('uav-time'), endMvp: $('end-mvp'),
    strikeReady: $('strike-ready'), strikeCount: $('strike-count'),
  };
  private radar = $<HTMLCanvasElement>('radar').getContext('2d')!;
  private dmgDirAngle = 0;
  private lastDmgAt = 0;
  private centerTimer = 0;
  private compassPx = 0;

  constructor() {
    this.buildCompass();
    this.el.radioMenu.innerHTML = '<h4>RÁDIO TÁTICO</h4>' + RADIO_LINES.map((l, i) => `<div><b>${i + 1}</b>${esc(l)}</div>`).join('');
  }

  show(on: boolean): void {
    this.el.hud.classList.toggle('hidden', !on);
  }

  // ── Bússola ──────────────────────────────────────────────────────────────
  private buildCompass(): void {
    // 1 volta = 720 px; repete 3x para dar a volta sem costura
    const labels: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'L', 135: 'SE', 180: 'S', 225: 'SO', 270: 'O', 315: 'NO' };
    this.compassPx = 720;
    let html = '';
    for (let rep = 0; rep < 3; rep++) {
      for (let deg = 0; deg < 360; deg += 15) {
        const x = rep * 720 + deg * 2;
        // Só pontos cardeais/colaterais e números a cada 30°; marcas a cada 15°
        if (labels[deg]) html += `<span class="${deg % 90 === 0 ? 'card' : ''}" style="left:${x}px">${labels[deg]}</span>`;
        else if (deg % 30 === 0) html += `<span style="left:${x}px">${deg}</span>`;
        html += `<span class="tick" style="left:${x}px"></span>`;
      }
    }
    this.el.compassStrip.innerHTML = html;
  }

  private updateCompass(yaw: number): void {
    // Norte = -Z. Heading em graus no sentido horário.
    let heading = (-yaw * 180) / Math.PI;
    heading = ((heading % 360) + 360) % 360;
    const w = this.el.compassStrip.parentElement!.clientWidth;
    this.el.compassStrip.style.transform = `translateX(${w / 2 - (this.compassPx + heading * 2)}px)`;
  }

  // ── Atualização por frame ───────────────────────────────────────────────
  update(s: {
    hp: number; stamina: number; purring: boolean; weapon: WeaponId; ammo: number; reloading: boolean;
    yaw: number; score: Record<Team, number>; timeLeft: number; ads: number; spread: number;
    me: { x: number; z: number; team: Team; id: number };
    players: NetPlayer[]; noisy: Map<number, number>; now: number; uav: number; airstrikes: number;
  }): void {
    const e = this.el;
    const hpPct = Math.max(0, (s.hp / MAX_HP) * 100);
    e.hpFill.style.width = `${hpPct}%`;
    e.hpFill.parentElement!.classList.toggle('low', s.hp <= 35);
    e.hpText.textContent = String(Math.ceil(s.hp));
    e.zoomFill.style.width = `${(s.stamina / STAMINA_MAX) * 100}%`;
    e.purr.classList.toggle('on', s.purring);

    const w = WEAPONS[s.weapon];
    e.weaponName.textContent = w.name.toUpperCase();
    const infinite = !Number.isFinite(w.mag);
    e.ammo.textContent = infinite ? '∞' : String(s.ammo);
    e.ammoMax.textContent = infinite ? '∞' : String(w.mag);
    e.ammo.classList.toggle('low', !infinite && s.ammo <= Math.ceil(w.mag * 0.25));
    e.reloadHint.textContent = s.reloading ? 'RECARREGANDO…' : '[R] RECARREGAR';
    e.reloadHint.classList.toggle('show', s.reloading || (!infinite && s.ammo <= Math.ceil(w.mag * 0.25)));
    for (const span of e.slots.children) span.classList.toggle('active', Number((span as HTMLElement).dataset.w) === s.weapon);

    e.scoreO.textContent = String(s.score.orange);
    e.scoreB.textContent = String(s.score.black);
    const m = Math.floor(s.timeLeft / 60), sec = s.timeLeft % 60;
    e.timer.textContent = `${m}:${String(sec).padStart(2, '0')}`;

    // Mira: abre com a dispersão, some no ADS
    const gap = 5 + s.spread * 400;
    const ch = e.crosshair.children as HTMLCollectionOf<HTMLElement>;
    ch[0].style.top = `${-gap - 9}px`; ch[1].style.top = `${gap}px`;
    ch[2].style.left = `${-gap - 9}px`; ch[3].style.left = `${gap}px`;
    e.crosshair.style.opacity = s.ads > 0.5 ? '0' : '1';
    e.scope.classList.toggle('on', s.weapon === 2 && s.ads > 0.85);

    // Indicador de direção do dano
    const since = s.now - this.lastDmgAt;
    e.dmgDir.style.opacity = since < 1200 ? String(1 - since / 1200) : '0';
    e.dmgDir.style.transform = `rotate(${this.dmgDirAngle - (-s.yaw)}rad)`;
    const lowHp = s.hp > 0 && s.hp < 35 ? 0.5 : 0;
    e.vignette.style.opacity = String(Math.max(lowHp, since < 400 ? 0.8 : 0));

    this.updateCompass(s.yaw);
    e.uav.classList.toggle('hidden', s.uav <= 0);
    if (s.uav > 0) e.uavTime.textContent = String(Math.ceil(s.uav));
    e.strikeReady.classList.toggle('hidden', s.airstrikes <= 0);
    e.strikeCount.textContent = s.airstrikes > 1 ? `×${s.airstrikes}` : '';
    this.drawRadar(s);
  }

  private drawRadar(s: { yaw: number; me: { x: number; z: number; team: Team; id: number }; players: NetPlayer[]; noisy: Map<number, number>; now: number; uav: number }): void {
    const g = this.radar;
    const W = 200, R = 100, range = 42;
    g.clearRect(0, 0, W, W);
    g.save();
    g.translate(R, R);
    // Anéis e varredura
    g.strokeStyle = 'rgba(182,255,92,0.18)';
    g.lineWidth = 1;
    for (const r of [33, 66, 96]) { g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(-R, 0); g.lineTo(R, 0); g.moveTo(0, -R); g.lineTo(0, R); g.stroke();
    const sweep = (s.now / 1000) % (Math.PI * 2);
    const grd = g.createConicGradient(sweep - Math.PI / 2, 0, 0);
    grd.addColorStop(0, 'rgba(182,255,92,0.28)');
    grd.addColorStop(0.12, 'rgba(182,255,92,0)');
    grd.addColorStop(1, 'rgba(182,255,92,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(0, 0, 97, 0, Math.PI * 2); g.fill();

    const cos = Math.cos(s.yaw), sin = Math.sin(s.yaw);
    for (const p of s.players) {
      if (p.id === s.me.id || !p.a) continue;
      const ally = p.tm === s.me.team;
      // Inimigos só aparecem ao atirar — ou sempre, enquanto o Drone Pombo do time estiver no ar
      const noisyAt = s.uav > 0 ? s.now : s.noisy.get(p.id) ?? -1e9;
      if (!ally && s.now - noisyAt > 2500) continue;
      const dx = p.x - s.me.x, dz = p.z - s.me.z;
      // Rotaciona para que "frente" fique para cima
      let rx = dx * cos - dz * sin;
      let ry = dx * sin + dz * cos;
      const d = Math.hypot(rx, ry);
      const scale = 96 / range;
      if (d > range) { rx = (rx / d) * range; ry = (ry / d) * range; }
      g.fillStyle = ally ? TEAM_ACCENT[p.tm] : '#ff4d4d';
      g.globalAlpha = ally ? 1 : Math.max(0.2, 1 - (s.now - noisyAt) / 2500);
      g.strokeStyle = 'rgba(0,0,0,0.8)';
      g.lineWidth = 1.5;
      const px = rx * scale, py = ry * scale;
      g.beginPath();
      // Aliado = círculo, inimigo = losango (não depende só da cor)
      if (ally) g.arc(px, py, 4.5, 0, Math.PI * 2);
      else { g.moveTo(px, py - 7); g.lineTo(px + 6, py); g.lineTo(px, py + 7); g.lineTo(px - 6, py); g.closePath(); }
      g.fill(); g.stroke();
    }
    g.globalAlpha = 1;
    // Você (seta)
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -8); g.lineTo(5, 6); g.lineTo(0, 3); g.lineTo(-5, 6); g.closePath(); g.fill();
    g.restore();
  }

  // ── Eventos ──────────────────────────────────────────────────────────────
  hitmarker(head: boolean, kill: boolean): void {
    const h = this.el.hit;
    h.classList.remove('show', 'head', 'kill');
    void h.offsetWidth;
    h.classList.add('show');
    if (head) h.classList.add('head');
    if (kill) h.classList.add('kill');
  }

  damage(fromX: number, fromZ: number, meX: number, meZ: number): void {
    this.lastDmgAt = performance.now();
    // Ângulo no mundo (0 = norte/-Z, sentido horário)
    this.dmgDirAngle = Math.atan2(fromX - meX, -(fromZ - meZ));
  }

  killfeed(k: { kn: string; vn: string; kt: Team; vt: Team; w: WeaponId; head: boolean }, involvesMe: boolean): void {
    const div = document.createElement('div');
    div.className = 'kf' + (involvesMe ? ' me' : '');
    div.innerHTML = `<span class="${k.kt}">${esc(k.kn)}</span><span class="w">[${esc(WEAPONS[k.w].name)}]</span>${k.head ? '<span class="hs">🎯</span>' : ''}<span class="${k.vt}">${esc(k.vn)}</span>`;
    this.el.killfeed.prepend(div);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.lastChild!.remove();
    setTimeout(() => div.remove(), 6000);
  }

  radio(from: string, id: number): void {
    const div = document.createElement('div');
    div.className = 'rf';
    div.innerHTML = `<b>📻 ${esc(from)}:</b> <span class="r">"${esc(RADIO_LINES[id])}"</span>`;
    this.el.radioFeed.appendChild(div);
    while (this.el.radioFeed.children.length > 4) this.el.radioFeed.firstChild!.remove();
    setTimeout(() => div.remove(), 5000);
  }

  toast(msg: string): void {
    const div = document.createElement('div');
    div.textContent = msg;
    this.el.toasts.appendChild(div);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild!.remove();
    setTimeout(() => div.remove(), 5000);
  }

  center(title: string, sub = '', ms = 1800): void {
    this.el.center.innerHTML = `${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
    this.el.center.classList.add('show');
    clearTimeout(this.centerTimer);
    this.centerTimer = window.setTimeout(() => this.el.center.classList.remove('show'), ms);
  }

  setDeath(on: boolean, by = '', secs = 0): void {
    this.el.death.classList.toggle('hidden', !on);
    if (on) {
      this.el.deathBy.innerHTML = by;
      this.el.deathTimer.textContent = secs > 0 ? `Reaparecendo em ${Math.ceil(secs)}` : 'Reaparecendo…';
    }
  }

  setRadioMenu(on: boolean): void {
    this.el.radioMenu.classList.toggle('hidden', !on);
  }

  setScoreboard(on: boolean, players: NetPlayer[], score: Record<Team, number>, myId: number): void {
    this.el.scoreboard.classList.toggle('hidden', !on);
    if (!on) return;
    for (const team of ['orange', 'black'] as Team[]) {
      $(`sbd-${team}`).textContent = String(score[team]);
      const rows = players.filter((p) => p.tm === team).sort((a, b) => b.k - a.k || a.d - b.d);
      $(`sbd-${team}-t`).innerHTML = '<tr><th>GATO</th><th>ABATES</th><th>MORTES</th><th>PING</th></tr>' + rows.map((p) =>
        `<tr class="${p.id === myId ? 'me' : ''} ${p.a ? '' : 'dead'}"><td>${esc(p.n)}${p.bot ? '<span class="bot">BOT</span>' : ''}</td><td>${p.k}</td><td>${p.d}</td><td>${p.bot ? '—' : p.pg}</td></tr>`).join('');
    }
  }

  setEnd(on: boolean, winner?: Team | 'draw', myTeam?: Team, nextIn = 10, mvp: { name: string; team: Team; k: number; d: number } | null = null): void {
    this.el.endMvp.innerHTML = mvp
      ? `🏅 MVP: <b style="color:${TEAM_ACCENT[mvp.team]}">${esc(mvp.name)}</b> — ${mvp.k} abates / ${mvp.d} mortes`
      : '';
    this.el.end.classList.toggle('hidden', !on);
    this.el.hud.classList.toggle('ended', on);
    if (!on || !winner) return;
    const t = this.el.endTitle;
    t.className = '';
    if (winner === 'draw') { t.textContent = 'EMPATE'; }
    else if (winner === myTeam) { t.textContent = 'VITÓRIA'; t.classList.add('win'); }
    else { t.textContent = 'DERROTA'; t.classList.add('lose'); }
    this.el.endSub.textContent = winner === 'draw'
      ? `Nova partida em ${nextIn}s`
      : `Os ${TEAM_NAME[winner]} dominaram a sala de estar · nova partida em ${nextIn}s`;
  }
}
