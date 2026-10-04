// Conexão WebSocket, relógio do servidor, buffer de snapshots e interpolação
// das entidades remotas (renderizadas ~100 ms no passado para ficarem suaves).

import type { ClientMsg, NetPlayer, ServerMsg } from '../../shared/types.ts';

const INTERP_DELAY = 100;

interface Snap {
  time: number;
  players: Map<number, NetPlayer>;
}

export interface InterpPlayer extends NetPlayer {
  speed: number;
}

export class Network {
  ws: WebSocket | null = null;
  connected = false;
  private snaps: Snap[] = [];
  private offset = 0; // serverTime ≈ performance.now() + offset
  private offsetInit = false;
  rtt = 0;
  onMessage: (msg: ServerMsg) => void = () => {};
  onClose: () => void = () => {};

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      // VITE_WS_URL aponta para um servidor de jogo hospedado fora (ex.: site na Vercel +
      // servidor no Render/Railway). Sem ela, usa o mesmo host da página.
      const url = import.meta.env.VITE_WS_URL || `${proto}://${location.host}/ws`;
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => { this.connected = true; resolve(); };
      ws.onerror = () => reject(new Error('Não foi possível conectar ao servidor'));
      ws.onclose = () => { this.connected = false; this.onClose(); };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as ServerMsg;
        if (msg.t === 'snap') this.pushSnap(msg.time, msg.players);
        if (msg.t === 'pong') this.rtt = this.rtt ? this.rtt * 0.8 + (performance.now() - msg.c) * 0.2 : performance.now() - msg.c;
        this.onMessage(msg);
      };
      setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
    });
  }

  send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private pushSnap(time: number, players: NetPlayer[]): void {
    const off = time - performance.now();
    // Usa o menor atraso observado (pacote mais rápido) e se adapta lentamente
    if (!this.offsetInit) { this.offset = off; this.offsetInit = true; }
    else if (off > this.offset) this.offset = off;
    else this.offset += (off - this.offset) * 0.02;
    this.snaps.push({ time, players: new Map(players.map((p) => [p.id, p])) });
    while (this.snaps.length > 40) this.snaps.shift();
  }

  serverNow(): number {
    return performance.now() + this.offset;
  }

  /** Tempo de servidor que está sendo exibido (usado na compensação de lag). */
  renderTime(): number {
    return this.serverNow() - INTERP_DELAY;
  }

  /** Estado interpolado de todos os jogadores no tempo de renderização. */
  interpolated(): InterpPlayer[] {
    const snaps = this.snaps;
    if (snaps.length === 0) return [];
    const t = this.renderTime();
    let a = snaps[0], b = snaps[0];
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].time <= t) { a = snaps[i]; b = snaps[i + 1] ?? snaps[i]; break; }
    }
    const span = b.time - a.time;
    const k = span > 0 ? Math.max(0, Math.min(1, (t - a.time) / span)) : 0;
    const out: InterpPlayer[] = [];
    for (const pb of b.players.values()) {
      const pa = a.players.get(pb.id) ?? pb;
      // Não interpola através de respawn/teleporte
      const teleport = pa.a !== pb.a || Math.hypot(pb.x - pa.x, pb.z - pa.z) > 6;
      const kk = teleport ? 1 : k;
      let dyaw = pb.yw - pa.yw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const speed = span > 0 && !teleport ? Math.hypot(pb.x - pa.x, pb.z - pa.z) / (span / 1000) : 0;
      out.push({
        ...pb,
        x: pa.x + (pb.x - pa.x) * kk,
        y: pa.y + (pb.y - pa.y) * kk,
        z: pa.z + (pb.z - pa.z) * kk,
        yw: pa.yw + dyaw * kk,
        pt: pa.pt + (pb.pt - pa.pt) * kk,
        speed,
      });
    }
    return out;
  }

  latest(): Map<number, NetPlayer> | null {
    return this.snaps.length ? this.snaps[this.snaps.length - 1].players : null;
  }
}
