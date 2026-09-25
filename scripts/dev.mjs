// Sobe servidor de jogo (porta 3000) e cliente Vite (porta 5173 ou $PORT) juntos.
import { spawn } from 'node:child_process';

const clientPort = process.env.PORT || '5173';
const serverPort = process.env.SERVER_PORT || '3000';

const procs = [
  spawn('node', ['--watch', 'server/server.ts'], { stdio: 'inherit', env: { ...process.env, PORT: serverPort } }),
  spawn('npx', ['vite', '--port', clientPort], { stdio: 'inherit', env: { ...process.env, SERVER_PORT: serverPort } }),
];
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { if (code) stop(); });
