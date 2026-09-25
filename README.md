# 🐾 Chico of Duty

FPS 3D multiplayer no navegador em que os soldados são gatinhos. Team Deathmatch
(Laranjas vs Pretos, 25 abates) na "Sala de Estar Proibida", com bots de IA
preenchendo as vagas. *Bravo Six, going meow.*

## Rodando

```bash
npm install
npm run dev        # servidor (porta 3000) + cliente Vite (porta 5173)
```

Abra http://localhost:5173. Para testar o multiplayer, abra outra aba/janela anônima
ou acesse pelo IP da máquina na mesma rede Wi-Fi (o Vite mostra o endereço "Network").

Produção (um único processo servindo cliente + WebSocket na porta 3000):

```bash
npm run build
npm start
```

Variáveis: `PORT` (porta do servidor em produção), `SERVER_PORT` (porta do servidor no
`npm run dev`, se a 3000 estiver ocupada). `?debug` na URL dispensa o Pointer Lock
(útil em navegadores embutidos).

## Testes

```bash
npm test           # 24 testes: movimento, rotas de escalada, armas, regras do servidor, bots
```

O `npm run build` roda typecheck + testes antes de gerar o bundle. Com `?debug` na URL,
o jogo publica métricas de renderização em `document.body.dataset.stats`.

## Jogabilidade (inspirada em CS:GO / CoD)

- **Precisão**: parado e agachado é preciso; andando/correndo/no ar a dispersão abre
  (a sniper exige parar). O mesmo cálculo roda no servidor e na mira do HUD.
- **Recuo**: o Meow-4A1 segue um padrão fixo (sobe e oscila para os lados) — dá para
  aprender a compensar; o 1º tiro é sempre preciso e a rajada abre o *bloom*.
- **ADS** reduz a velocidade para 60%; ao sair da corrida há 150 ms antes de atirar.
- **Killstreak "Drone Pombo"**: 3 abates sem morrer revelam os inimigos no radar do
  time por 12 s.
- **Morte**: mostra a vida restante de quem te abateu e a distância. Fim de partida
  mostra o MVP.
- Análise completa e backlog: [docs/ANALISE_FPS.md](docs/ANALISE_FPS.md).

## Controles

| Tecla | Ação |
|---|---|
| WASD / Mouse | mover / mirar |
| Clique esquerdo / direito | atirar / ADS (luneta na Cat-98k; anda mais devagar) |
| Espaço | pulo alto felino |
| Shift | Zoomies (arrancada, gasta energia) |
| C ou Ctrl | agachar; correndo = slide |
| R | recarregar |
| 1 2 3 / roda | Meow-4A1 · Purr-Pump · Cat-98k |
| V / botão lateral | patada tática |
| Z + 1–6 | rádio tático do esquadrão |
| Tab | placar |

Agachado, parado e sem levar dano por 2,5 s, o gato **ronrona** e recupera vida.

## Arquitetura

```
shared/      código comum a cliente e servidor
  map.ts       geometria do mapa (AABBs espelhados por time) e spawns
  sim.ts       física de movimento determinística + raycast/hitboxes
  weapons.ts   atributos das armas
  types.ts     protocolo de rede (JSON)
server/      servidor autoritário (Node ≥ 23 executa .ts direto)
  server.ts        HTTP + WebSocket em /ws
  GameManager.ts   regras de TDM, tiros, dano, respawn, bots, snapshots a 30 Hz
  Physics.ts       resolução de tiros com compensação de lag (até 300 ms)
  BotManager.ts    IA: patrulha, perseguição, strafe, mira imperfeita, cura
client/      Three.js + Vite
  src/main.ts        loop, predição a 60 Hz + reconciliação, efeitos
  src/Network.ts     relógio do servidor e interpolação (100 ms)
  src/Viewmodel.ts   patinhas em 1ª pessoa, ADS, recuo, recarga
  src/MapBuilder.ts  sala com texturas procedurais
  src/CatModel.ts    gatos em 3ª pessoa
  src/Audio.ts       Web Audio: samples de /sfx com síntese procedural de reserva
```

O cliente simula o próprio movimento com o mesmo `stepPlayer` do servidor e reaplica
os inputs ainda não confirmados a cada snapshot; o servidor valida cadência, munição e
recarga, e faz o raycast dos tiros "voltando no tempo" até o que o atirador via.

## Sons (ElevenLabs)

`client/public/sfx/` traz efeitos gerados com o ElevenLabs (tiros, recarga, miados,
ronronado, rádio, vitória/derrota) e as falas do rádio em pt-BR. Para regenerar:

```bash
ELEVENLABS_API_KEY=... npm run sfx
```

Qualquer arquivo ausente cai automaticamente na versão sintetizada. Um `music.mp3`
opcional nessa pasta toca em loop como trilha.

## Créditos de assets (todos CC0 / domínio público)

| Asset | Autor / fonte | Uso |
|---|---|---|
| `client/public/models/cat.glb` — "Cat" animado | [Quaternius](https://quaternius.com) via [Poly Pizza](https://poly.pizza/m/qKICY6xla2) | gatos em 3ª pessoa (Idle, Walk, Run, Jump, Death, Headbutt) |
| `client/public/tex/wood_floor_*` | [Poly Haven — Wood Floor](https://polyhaven.com/a/wood_floor) | piso de tacos |
| `client/public/tex/denim_fabric_*` | [Poly Haven — Denim Fabric](https://polyhaven.com/a/denim_fabric) | trama do sofá e almofadas |
| `client/public/tex/lebombo_1k.hdr` | [Poly Haven — Lebombo](https://polyhaven.com/a/lebombo) | iluminação ambiente e reflexos |
| `client/public/sfx/*` | gerados com ElevenLabs | efeitos e falas do rádio |

As pelagens são geradas recolorindo o atlas do gato em tempo de execução
(`client/src/CatAsset.ts`). Se o GLB não carregar, o jogo usa o gato procedural.

