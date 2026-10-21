# 🕹️ Pocket Corner — Desktop Toy Social Multiplayer

Um **Desktop Toy** social multiplayer em pixel art focado em presença passiva (*idle*), microinterações caóticas e colecionismo cosmético, operando em arquitetura híbrida (**Web Document Picture-in-Picture API** + **Tauri v2 Transparent Desktop Overlay** + **Node.js & Socket.IO**).

---

## 🚀 Como Rodar e Usar em Conjunto

### 1. Iniciar o Sistema (Servidor Multiplayer + Cliente Web)
```bash
npm install
npm run dev
```
- **Cliente Web (Vite com suporte a LAN):** `http://localhost:5173`
- **Servidor Realtime (Express + Socket.IO):** `http://localhost:3001`

### 2. Como Conectar com Amigos
1. **Na mesma rede Wi-Fi / LAN:** Veja o endereço `Network: http://192.168.x.x:5173` exibido no terminal do Vite e envie para seu amigo, ou use o botão **🔗 Copiar Link Convite** no topo do seu cantinho.
2. **Testando com múltiplas contas no mesmo computador:** Abra uma segunda aba usando `?user=amigo2` (ex: `http://localhost:5173/?user=amigo2`) ou clique em **🔄 Trocar Perfil** no topo.
3. **Bot Amigo Integrado (`@pipoca_bot`):** Clique em **🐦 Simular Visita do Pipoca (Bot)** para testar visitas imediatas, o modo `KNOCK` (campainha + 30s espiando na borda), arremessos de avião de papel e presentes AFK no chão!

---

## ✨ Funcionalidades Implementadas

- **🪟 Web MVP (Document Picture-in-Picture API):** Clique em **Abrir Sempre no Topo (PiP)** para destacar seu cantinho em uma mini-janela `360x180` sempre visível sobre outros programas.
- **👻 Modo Transparente Tauri v2 (`setIgnoreCursorEvents`):** Configurado em [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) com janela transparente (`transparent: true`), sem bordas (`decorations: false`) e *click-through* automático no espaço vazio acima do piso de `20px`.
- **🏠 O Espaço Pessoal ("Meu Cantinho"):**
  - Movimentação 1D/2.5D no eixo `X` (clique no chão ou `A`/`D`/Setas) e pulo com gravidade no eixo `Y` (`Espaço`/`W`).
  - Estados do Host: `ACTIVE`, `IDLE` (com animações automáticas: ☕ *Café*, ⌨️ *Digitar*, 💤 *Cochilar*, 🎣 *Pescar*) e `DND` (*Não Perturbe*).
- **🚪 Sistema de Visitas ("Invadir a Tela"):**
  - Até **4 visitantes simultâneos + 1 Host (5 avatares)**.
  - Modos `OPEN` (entrada imediata com *Spawn FX*) e `KNOCK` (visitante espia na borda da janela com som de campainha e timer de 30s para o Host aceitar ou ignorar).
- **🎉 Microinterações & Presentes AFK:**
  - **Balão de Chat:** Máx. 80 caracteres, flutua por 6 segundos e some, com som 8-bit customizado por *Chat Skin*.
  - **Ações Físicas:** Cutucar (`POKE`), Arremessar brinquedo em arco parabólico (`THROW_ITEM`) e Emotes Sincronizados (`SYNC_EMOTE`).
  - **Presentes de Mesa (`DESK_DROP`):** Deixe Café Expresso (dá velocidade 2x temporária ao Host!), Pato de Borracha, Post-it, Bolo de Aniversário ou Gato Dormindo no chão do amigo.
- **🛡️ Economia & *Server-Side Inventory Verification*:**
  - O cliente envia apenas o `item_id` e o servidor valida no banco de dados ([`server/store.ts`](server/store.ts)) se o `user_id` realmente possui o cosmético antes de equipar ou retransmitir para a sala.
  - **Moeda Idle (🪙)** ganha passivamente + **Máquina Gachapon** + **Loja Cosmética** com **Gems (💎)**.
