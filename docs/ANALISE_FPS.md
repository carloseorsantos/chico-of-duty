# Chico of Duty — análise de jogabilidade vs. CoD / CS:GO

Documento de trabalho: o que um FPS AAA tem, onde o Chico of Duty está, o que entra
**agora** (Definition of Done) e o que fica no backlog.

## 1. Comparação por pilar

| Pilar | CoD / CS:GO | Chico of Duty (antes deste ciclo) | Lacuna |
|---|---|---|---|
| **Netcode** | Servidor autoritário, predição, reconciliação, interpolação, lag comp. | Tudo isso já existe (30 Hz, predição a 60 Hz, rewind de 300 ms) | Baixa |
| **Precisão / gunplay** | CS: imprecisão por movimento, *spray pattern* fixo, *first-shot accuracy*. CoD: ADS reduz dispersão e velocidade | Dispersão só muda com ADS e ar; recuo 100% aleatório | **Alta** — atirar correndo é tão preciso quanto parado |
| **Ritmo de combate** | *Sprint-out time* (não atira no 1º frame após correr), ADS mais lento | Atira instantâneo saindo da corrida; ADS não afeta velocidade | Média |
| **Câmera / escala** | Olho alinhado ao modelo (o que você vê é o que os outros veem) | Câmera a 0,94 u; cabeça do gato a ~0,6 u | Média (visual × hitbox) |
| **Recompensa / progressão** | Killstreaks (UAV, etc.), MVP, estatísticas | Só placar | **Alta** — sem objetivos de curto prazo |
| **Feedback de morte** | CS mostra a vida do assassino; CoD tem killcam | Só nome e arma | Média |
| **Opções** | FOV, sensibilidade, ADS sens, volume, mira | Sensibilidade e volume | Média |
| **Carregamento** | Tela de loading, assets prontos antes de jogar | Entra antes do GLB/HDRI carregarem | Média |
| **Desempenho** | Pools de partículas, poucos draw calls | Um material novo por partícula/traçante; sem medição | Média |
| **Testes** | QA automatizado | Scripts avulsos | **Alta** — sem `npm test` |

## 2. Definition of Done (este ciclo)

Cada item só conta como feito quando o critério de verificação passar.

| # | Entrega | Verificação |
|---|---|---|
| D1 | **Câmera na cabeça do gato** (olho ≈ 0,62 em pé, 0,45 agachado); origem dos tiros no servidor usa a mesma altura | teste: `eyeY` em pé/agachado; jogo no navegador |
| D2 | **Imprecisão por movimento** (velocidade horizontal aumenta a dispersão) no servidor e na mira do cliente, pela mesma função compartilhada | teste: dispersão parado < andando < correndo |
| D3 | **Bloom por tiros seguidos + padrão de recuo fixo** do Meow-4A1 (sobe e depois oscila para os lados, como no CS); primeiro tiro preciso | teste: 1º tiro sem bloom; rajada aumenta; reset após pausa |
| D4 | **ADS reduz velocidade** (60%) — flag no `InputCmd`, simulada igual nos dois lados | teste: velocidade máxima com/sem ADS |
| D5 | **Sprint-out delay** de 150 ms antes de atirar após correr | revisão + jogo |
| D6 | **Killstreak "Drone Pombo"**: 3 abates sem morrer → radar do time revela inimigos por 12 s, com aviso no HUD e no rádio | teste no servidor + HUD no navegador |
| D7 | **Recapitulação da morte**: vida restante do assassino e distância | teste da mensagem + tela de morte |
| D8 | **MVP da partida** na tela de fim de jogo | teste: fim da partida traz o MVP |
| D9 | **Opção de FOV** (70–110) persistida | navegador |
| D10 | **Tela de carregamento**: botão "Entrar" só libera com gato + HDRI carregados (com timeout de segurança) | navegador |
| D11 | **Otimização de efeitos**: materiais compartilhados, limite de partículas; medir draw calls/frame | `renderer.info` antes/depois |
| D12 | **Suíte `npm test`** cobrindo movimento (pulo, slide, alcance dos móveis), ronronar, armas (cadência, munição, recarga, headshot, dispersão), killstreak, fim de partida, balanceamento de bots | `npm test` verde |
| D13 | **Sessão de 60 s no navegador sem erros no console**, todas as armas disparando | console limpo |
| D14 | Typecheck + build de produção limpos | `npm run build` |

### Resultado da verificação (todos os itens concluídos)

| # | Status | Evidência |
|---|---|---|
| D1 | ✅ | `tests/movement.test.ts` (olhos 0,62 / 0,45); câmera no navegador |
| D2 | ✅ | `spreadFor` compartilhado; teste "parado < andando < correndo" |
| D3 | ✅ | teste de bloom; padrão `RIFLE_SPRAY_YAW` aplicado no cliente |
| D4 | ✅ | teste "ADS desacelera para 60%" (razão 0,60) |
| D5 | ✅ | `WeaponManager.SPRINT_OUT_MS = 150` (revisão de código) |
| D6 | ✅ | teste de killstreak + navegador: "DRONE POMBO NO AR", contador no HUD, inimigos no radar, aviso "DRONE INIMIGO!" |
| D7 | ✅ | navegador: "Cabo Miau ficou com 41 de vida · distância 15 m" |
| D8 | ✅ | partida real terminou 25–22 com "MVP: Maj. Ronron — 9 abates / 10 mortes"; nova partida iniciou sozinha |
| D9 | ✅ | slider "Campo de visão" 70–110, salvo em `localStorage` |
| D10 | ✅ | botão "CARREGANDO…" até gato GLB + HDRI (timeout de 8 s) |
| D11 | ✅ | draw calls parado **843 → 156**; triângulos 76k → 40k; objetos na cena constantes durante rajadas (pools); sombra estática |
| D12 | ✅ | `npm test`: 24/24 (movimento, 7 rotas de escalada, armas, servidor, bots) |
| D13 | ✅ | sessões no navegador com as 4 armas, morte, drone e fim de partida — 0 erros no console |
| D14 | ✅ | `npm run build` (typecheck + testes + bundle) verde |

## 3. Backlog (fora deste ciclo)

- Killcam com replay dos últimos 5 s (precisa gravar snapshots por jogador).
- Mais modos: Kill Confirmed (coleiras em vez de placas), Search & Destroy com "novelo-bomba".
- Loadouts/atributos (perks felinos: *Sete Vidas*, *Patas de Veludo* = passos silenciosos).
- Oclusão de áudio (passos abafados atrás de paredes) e reverb por ambiente.
- Pós-processamento (bloom no clarão, SSAO) com toggle de qualidade.
- Modelos de arma em GLB e animações de recarga por arma.
- Reação a dano nos modelos (flinch) e ragdoll.
- Suporte a toque/celular e controle.
- Compressão delta dos snapshots e interesse por área (mais de 16 jogadores).
- Matchmaking/salas múltiplas e servidor dedicado com deploy.
- Anti-cheat além da validação atual (heurística de mira, taxa de input).
