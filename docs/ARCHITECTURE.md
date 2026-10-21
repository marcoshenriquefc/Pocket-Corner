# Documentação de Arquitetura & Game Design: "Pocket Corner" (Nome Provisório)

## 1. Visão Geral do Produto
Um "Desktop Toy" social multiplayer em pixel art, focado em presença passiva (idle), microinterações caóticas e colecionismo cosmético. O sistema opera em arquitetura híbrida desde o primeiro dia:
1. **Web MVP (Zero-Install):** Roda via navegador utilizando a **Document Picture-in-Picture API** para manter uma mini-janela sempre no topo (*Always-on-Top*).
2. **Desktop Client (Expansão Nativa):** O mesmo código frontend empacotado via **Tauri**, permitindo janela transparente (`transparent: true`), sem bordas (`decorations: false`), fixada sobre a barra de tarefas do Sistema Operacional e com suporte a *click-through* nas áreas vazias.

---

## 2. Regras de Negócio e Mecânicas de Jogo (Core Loop)

### 2.1. O Espaço Pessoal ("Meu Cantinho")
* **Dimensões Base:** Canvas horizontal compacto (ex: `360x180px` no modo PiP ou faixa na base do monitor no Tauri).
* **Movimentação Simplificada (1D/2.5D):** Os avatares se movem apenas no eixo `X` (esquerda/direita) e possuem um eixo `Y` apenas para pulos/gravidade simples. Isso reduz drasticamente o tráfego de rede e simplifica colisões.
* **Estados do Host (Dono da Sala):**
  * `IDLE`: O usuário está trabalhando em outra janela; o avatar realiza animações automáticas (beber café, digitar, cochilar, pescar).
  * `ACTIVE`: O usuário está com o foco do mouse no widget interagindo.
  * `DND` (Não Perturbe): Tranca a sala; ninguém pode visitar (apenas deixar presentes na caixa de correio).

### 2.2. Sistema de Visitas ("Invadir a Tela")
* **Capacidade da Sala:** Máximo de **4 visitantes simultâneos** + 1 Host (5 avatares no total) para evitar poluição visual na tela de trabalho.
* **Modos de Permissão da Porta:**
  * `OPEN`: Amigos entram diretamente acionando sua animação de *Spawn*.
  * `KNOCK`: O visitante aparece espiando na borda da janela e emite um som suave de campainha. O Host tem 30 segundos para clicar em "Aceitar" ou ignorar.
* **Interações Permitidas na Sala Alheia:**
  1. **Balão de Chat:** Mensagens curtas (máx. 80 caracteres) que flutuam sobre a cabeça do avatar por 6 segundos e somem (sem histórico de texto infinito para manter a estética limpa).
  2. **Ações Físicas (Poke/Throw):** Arremessar bolinha de papel, cutucar o avatar do amigo (fazendo-o dar um pulinho) ou ativar emotes sincronizados.
  3. **Deixar Item de Mesa (AFK Gift):** Se o amigo não estiver olhando, o visitante pode deixar um item temporário no chão dele (ex: um café fumegante, um pato de borracha ou um post-it). O item dura até o Host clicar nele.

---

## 3. Economia e Regras de Monetização (Cosméticos)

### 3.1. Princípio de Ouro: *Server-Side Inventory Verification*
> **Regra Crítica:** O cliente **NUNCA** informa ao servidor qual sprite ou efeito ele possui. O cliente envia apenas o `item_id` que deseja equipar/usar, e o servidor valida no banco de dados se o `user_id` realmente é dono daquele cosmético antes de retransmitir para a sala.

### 3.2. Categorias de Cosméticos
| Categoria | Comportamento no Sistema | Exemplos |
| :--- | :--- | :--- |
| **Avatares & Acessórios** | Spritesheets modulares (Corpo, Cabeça, Costas). | Fantasia de Pombo, Capacete Astronauta, Mochila Jetpack. |
| **Efeitos de Entrada (`Spawn FX`)** | Animação executada no momento do evento `room:join`. | Raio Cyberpunk, Queda de Paraquedas, Caixa de Papelão, Abdução Alienígena. |
| **Balões de Fala (`Chat Skins`)** | Estilização CSS/Canvas do balão + som de digitação (`blip`). | Pergaminho Medieval, Placa de Neon, Balão em Chamas. |
| **Brinquedos Arremessáveis** | Altera o projétil da ação `interact:throw`. | Avião de Papel Dourado, Peixe Congelado, Bomba de Glitter. |
| **Temas de Cantinho (`Room Skins`)** | Altera o background e objetos interativos do Host. | Cobertura Chuvosa Lofi, Fogueira na Floresta, Vagão de Trem em Movimento. |
| **Presentes de Mesa (`Desk Drops`)** | Objetos deixados na tela de amigos AFK. | Café Expresso (dá velocidade temporária), Bolo de Aniversário, Gato Dormindo. |

### 3.3. Moeda Gratuita vs. Premium
* **Moeda Idle (Grátis):** Ganha passivamente por tempo com o cantinho aberto ou ao receber visitas. Usada em uma máquina de *Gachapon* básica.
* **Moeda Premium (Paga):** Usada para comprar cosméticos exclusivos, efeitos de entrada lendários e temas de cenário.

---

## 4. Arquitetura Técnica

### 4.1. Stack Recomendada
* **Frontend:** Gerenciamento de UI, Loja, Login + Renderização 2D ultra-leve para o Canvas do jogo.
* **Camada de Janela:**
  * *Web:* `window.documentPictureInPicture.requestWindow({ width: 360, height: 180 })`
  * *Desktop:* **Tauri v2** (Rust wrapper de ~3MB consumindo o build web).
* **Backend Realtime:** Node.js + **Socket.io**.
* **Persistência & Cache:**
  * **Banco Persistente:** Contas de usuários, lista de amigos, inventário de cosméticos e transações.
  * **Cache de Sessão/Salas (Estilo Redis):** Estado efêmero das salas (`room:user_123`), posições `X` atuais, controle de presença online e *Rate Limiting* de WebSockets.

### 4.2. Adaptação Híbrida: Web PiP vs. Tauri Transparente
O código do jogo deve ler uma variável de ambiente/contexto (`isTauri`) para ajustar apenas o container:
* **No Navegador (PiP):** Renderiza o fundo completo do cenário (`Room Skin`) preenchendo os `360x180px`.
* **No Tauri (OS Overlay):** O fundo do HTML/Canvas é `rgba(0, 0, 0, 0)`. Apenas o piso (uma faixa de 20px na base) e os avatares são visíveis. Utiliza a API do Tauri `setIgnoreCursorEvents(true)` quando o mouse está no espaço transparente, permitindo que o usuário clique nos programas atrás do jogo sem que o jogo roube o foco.

---

## 5. Protocolo de Comunicação (WebSockets)

Cada usuário autenticado possui sua própria sala identificada por `room:${user_id}`.

### 5.1. Eventos Cliente -> Servidor (Inputs)
O cliente envia apenas intenções de ação. Nenhum cálculo de permissão ou validação ocorre no frontend.

```json
// 1. Solicitar visita a um amigo
{ "event": "room:visit", "payload": { "targetUserId": "usr_999" } }

// 2. Mover avatar no eixo X (Throttled: máx 10 envios/seg)
{ "event": "player:move", "payload": { "targetX": 240 } }

// 3. Enviar mensagem de balão
{ "event": "player:chat", "payload": { "text": "Bora pro café?" } }

// 4. Interagir / Jogar objeto em outro jogador na mesma sala
{ "event": "player:interact", "payload": { "targetUserId": "usr_999", "actionType": "THROW_ITEM" } }
```

### 5.2. Eventos Servidor -> Clientes na Sala (Broadcast)
O servidor valida a ação, anexa os cosméticos reais do usuário salvos no cache/banco e transmite para a sala:

```json
// Broadcast de chegada de visitante
{
  "event": "room:user_joined",
  "payload": {
    "userId": "usr_123",
    "username": "DevPlayer",
    "x": 50,
    "equippedCosmetics": {
      "skin": "skin_pigeon_suit",
      "spawnEffect": "fx_lightning_strike",
      "chatBubble": "bubble_cyberpunk"
    }
  }
}
```

---

## 6. Regras de Segurança e Anti-Abuso ("Nunca Confie no Frontend")

Como o aplicativo roda na tela de trabalho das pessoas, qualquer falha de segurança ou spam se torna extremamente irritante. O backend deve impor as seguintes travas:

1. **Autoridade Total do Servidor sobre Cosméticos:**
   * No momento da conexão WebSocket, o servidor carrega do banco os itens equipados do usuário e salva na sessão do cache.
   * Qualquer tentativa do frontend de enviar `{ "skin": "admin_gold" }` no payload do socket é completamente ignorada pelo servidor.
2. **Validação de Grafo Social (Anti-Invasão):**
   * O evento `room:visit` verifica no Banco/Cache se existe relação de amizade `ACCEPTED` entre `visitor_id` e `host_id` **E** se o status da sala do Host não está como `DND` ou lotada (`count >= 5`).
3. **Sanitização e Limite de Chat:**
   * Strip total de tags HTML/Scripts no backend antes do broadcast.
   * Corte rígido (`slice(0, 80)`) no tamanho da string no servidor.
4. **Rate Limiting por Socket (Token Bucket):**
   * `player:move`: Máximo de 10 pacotes por segundo. Coordenadas `targetX` fora do limite `< 0` ou `> 360` são descartadas.
   * `player:chat`: Máximo de 1 mensagem a cada 2 segundos.
   * `player:interact` (Cutucar/Jogar objetos): Máximo de 1 ação a cada 3 segundos (evita travar a tela do amigo com milhares de partículas).
   * `room:visit`: Cooldown de 5 segundos entre trocas de sala.
5. **Botão de Pânico ("Expulsar / Fechar Cortina"):**
   * O Host possui um botão local que emite `room:kick_all`, desconectando instantaneamente todos os sockets visitantes da sua sala e mudando seu status para `DND`.

---

## 7. Roadmap de Desenvolvimento (Fases)
* **Fase 1: O Protótipo PiP** — Document Picture-in-Picture + Canvas 2D + Movimento eixo X e balão de fala sincronizados.
* **Fase 2: O Loop Social & Interações** — Login, Grafo de Amizade (`ACCEPTED`), permissão de porta (`OPEN`/`KNOCK`), física de arremessar objetos em parábola e presente AFK na mesa.
* **Fase 3: Cosméticos & Persistência** — Banco de dados para inventário + validação Server-Side, Spawn Effects, Skins e Cenários.
* **Fase 4: Empacotamento Tauri (Expansão Desktop)** — Build Tauri apontando para o frontend existente com transparência e click-through nas áreas sem pixels.
