// Ponto de entrada: HTTP (serve o build do cliente em produção) + WebSocket em /ws.
// Uso: `node server/server.ts` (Node ≥ 23 executa TypeScript diretamente).

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMsg } from '../shared/types.ts';
import { GameManager } from './GameManager.ts';
import type { Player } from './types.ts';

const PORT = Number(process.env.PORT) || 3000;
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon',
};

const http = createServer((req, res) => {
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Servidor Chico of Duty rodando. Em desenvolvimento, abra o cliente Vite em http://localhost:5173');
    return;
  }
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = normalize(join(DIST, url === '/' ? 'index.html' : url));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const game = new GameManager();
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws: WebSocket) => {
  let player: Player | null = null;
  let pingSent = 0;
  const pinger = setInterval(() => { pingSent = Date.now(); ws.ping(); }, 2000);
  ws.on('pong', () => { if (player) game.setPing(player, Date.now() - pingSent); });

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'join') {
      if (!player) player = game.join(ws, String(msg.name ?? ''), msg.skin, msg.team);
      return;
    }
    if (player) game.handle(player, msg);
  });

  ws.on('close', () => {
    clearInterval(pinger);
    if (player) game.leave(player);
    player = null;
  });
});

game.start();
http.listen(PORT, '0.0.0.0', () => {
  console.log(`🐾 Chico of Duty — servidor ouvindo na porta ${PORT} (WebSocket em /ws)`);
});
