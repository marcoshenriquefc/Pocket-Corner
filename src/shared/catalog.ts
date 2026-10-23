import { CosmeticItem, EquippedLoadout, RealMoneyPackage } from './types';

export const GACHAPON_COST_COINS = 80;

export interface FurnitureColorOption {
  id: string;
  label: string;
  primary: string;
  secondary: string;
  accent: string;
}

export const FURNITURE_COLOR_PALETTE: FurnitureColorOption[] = [
  { id: 'default', label: 'Original', primary: '', secondary: '', accent: '' },
  { id: 'crimson', label: 'Rubi', primary: '#9f1239', secondary: '#e11d48', accent: '#fda4af' },
  { id: 'emerald', label: 'Esmeralda', primary: '#065f46', secondary: '#10b981', accent: '#6ee7b7' },
  { id: 'ocean', label: 'Oceano', primary: '#075985', secondary: '#0ea5e9', accent: '#7dd3fc' },
  { id: 'purple', label: 'Ametista', primary: '#5b21b6', secondary: '#8b5cf6', accent: '#c4b5fd' },
  { id: 'gold', label: 'Mostarda', primary: '#92400e', secondary: '#eab308', accent: '#fef08a' },
  { id: 'dark', label: 'Ônix', primary: '#0f172a', secondary: '#334155', accent: '#94a3b8' },
  { id: 'cream', label: 'Creme', primary: '#78716c', secondary: '#d6d3d1', accent: '#fafaf9' },
];

export function getFurnitureColorOption(variantId?: string): FurnitureColorOption | undefined {
  if (!variantId || variantId === 'default') return undefined;
  return FURNITURE_COLOR_PALETTE.find((c) => c.id === variantId);
}

export const DEFAULT_EQUIPPED: EquippedLoadout = {
  avatar_body: 'body_human',
  avatar_head: 'head_none',
  avatar_back: 'back_none',
  spawn_fx: 'fx_pop',
  chat_skin: 'chat_default',
  throwable: 'throw_paper_ball',
  room_skin: 'room_cozy_desk',
  desk_drop: 'drop_coffee',
};

export const COSMETIC_CATALOG: CosmeticItem[] = [
  // ==========================================
  // 1. AVATARES (CORPO)
  // ==========================================
  {
    id: 'body_human',
    name: 'Humano Cozy',
    category: 'avatar_body',
    rarity: 'COMMON',
    currency: 'COINS',
    price: 0,
    inGachapon: false,
    isStarter: true,
    description:
      'Moletom confortável pronto para programar e tomar café. Personalize gratuitamente o tom de pele e a cor da roupa!',
    icon: '🧑',
    previewColor: '#6366f1',
  },
  {
    id: 'body_fox',
    name: 'Raposa Astuta',
    category: 'avatar_body',
    rarity: 'RARE',
    currency: 'COINS',
    price: 120,
    inGachapon: true,
    description: 'Raposinha laranja com orelhas pontudas, focinho branco e cauda felpuda.',
    icon: '🦊',
    previewColor: '#ea580c',
  },
  {
    id: 'body_fish',
    name: 'Peixinho Tropical',
    category: 'avatar_body',
    rarity: 'COMMON',
    currency: 'COINS',
    price: 150,
    inGachapon: true,
    description:
      'Peixinho colorido com barbatanas animadas e bolhas de ar. Escolha livremente entre 8 cores tropicais!',
    icon: '🐠',
    previewColor: '#0ea5e9',
  },
  {
    id: 'body_frog',
    name: 'Sapinho Cururu',
    category: 'avatar_body',
    rarity: 'EPIC',
    currency: 'COINS',
    price: 200,
    inGachapon: true,
    description: 'Sapinho verde esmeralda com olhões saltados e bochechas rosadas.',
    icon: '🐸',
    previewColor: '#22c55e',
  },
  {
    id: 'body_penguin',
    name: 'Pinguim Gelado',
    category: 'avatar_body',
    rarity: 'RARE',
    currency: 'COINS',
    price: 150,
    inGachapon: true,
    description: 'Pinguim de smoking natural, bico dourado e passinho engraçado.',
    icon: '🐧',
    previewColor: '#38bdf8',
  },
  {
    id: 'body_capybara',
    name: 'Capivara Zen',
    category: 'avatar_body',
    rarity: 'COMMON',
    currency: 'COINS',
    price: 120,
    inGachapon: true,
    description: 'A rainha da paz com uma tangerina equilibrada na cabeça.',
    icon: '🦫',
    previewColor: '#b45309',
  },
  {
    id: 'body_pigeon',
    name: 'Fantasia de Pombo',
    category: 'avatar_body',
    rarity: 'RARE',
    currency: 'COINS',
    price: 150,
    inGachapon: true,
    description: 'Pombo urbano caótico em pixel art. Pruu!',
    icon: '🐦',
    previewColor: '#94a3b8',
  },
  {
    id: 'body_cyber_bot',
    name: 'Robô Retrô MK-II',
    category: 'avatar_body',
    rarity: 'COMMON',
    currency: 'COINS',
    price: 120,
    inGachapon: true,
    description: 'Chassi metálico com visor de LED animado.',
    icon: '🤖',
    previewColor: '#06b6d4',
  },
  {
    id: 'body_cat',
    name: 'Gatinho Laranja',
    category: 'avatar_body',
    rarity: 'RARE',
    currency: 'COINS',
    price: 180,
    inGachapon: true,
    description: 'Um gatinho pixelado com apenas um neurônio.',
    icon: '🐱',
    previewColor: '#f97316',
  },
  {
    id: 'body_deer',
    name: 'Veado',
    category: 'avatar_body',
    rarity: 'RARE',
    currency: 'COINS',
    price: 160,
    inGachapon: true,
    description: 'Veado da floresta com galhada ramificada, pintinhas brancas e focinho fofo.',
    icon: '🦌',
    previewColor: '#b45309',
  },
  {
    id: 'body_hawk',
    name: 'Gavião',
    category: 'avatar_body',
    rarity: 'RARE',
    currency: 'COINS',
    price: 180,
    inGachapon: true,
    description: 'Gavião imponente com plumagem escura, peito branco rajado e bico dourado.',
    icon: '🦅',
    previewColor: '#475569',
  },
  {
    id: 'body_red_panda',
    name: 'Panda Vermelho',
    category: 'avatar_body',
    rarity: 'EPIC',
    currency: 'GEMS',
    price: 30,
    inGachapon: true,
    description: 'Fofura máxima com sobrancelhas brancas e rabo anelado.',
    icon: '🐼',
    previewColor: '#dc2626',
  },
  {
    id: 'body_ghost',
    name: 'Fantasminha Boo',
    category: 'avatar_body',
    rarity: 'EPIC',
    currency: 'GEMS',
    price: 120,
    inGachapon: true,
    description: 'Flutua suavemente acima do chão com brilho ectoplásmico.',
    icon: '👻',
    previewColor: '#e2e8f0',
  },
  {
    id: 'body_caramelo',
    name: 'Caramelo',
    category: 'avatar_body',
    rarity: 'EPIC',
    currency: 'GEMS',
    price: 120,
    inGachapon: false,
    description: 'O lendário vira-lata Caramelo sentado, de óculos escuros e camisa listrada alvinegra!',
    icon: '🐕',
    previewColor: '#f5820b',
  },
  {
    id: 'body_dragon',
    name: 'Dragãozinho Rubi',
    category: 'avatar_body',
    rarity: 'LEGENDARY',
    currency: 'GEMS',
    price: 180,
    inGachapon: true,
    description: 'Pequeno dragão ancestral com chifres dourados, asas e barriga flamejante.',
    icon: '🐉',
    previewColor: '#ef4444',
  },
  {
    id: 'body_dj_double_d',
    name: 'DJ Double D (Lendário)',
    category: 'avatar_body',
    rarity: 'LEGENDARY',
    currency: 'GEMS',
    price: 999,
    inGachapon: false,
    realMoneyOnly: true,
    packId: 'pkg_double_d',
    description:
      '👑 EXCLUSIVO DOUBLE D PACK: Pip lendário do Double D sentado na pose clássica de barba, óculos escuros, camiseta rosé, relógio no pulso e segurando o fone de DJ!',
    icon: '🎧',
    previewColor: '#d6b4ad',
  },

  // ==========================================
  // 2. ACESSÓRIOS DE CABEÇA
  // ==========================================
  {
    id: 'head_none',
    name: 'Sem Chapéu',
    category: 'avatar_head',
    rarity: 'COMMON',
    currency: 'COINS',
    price: 0,
    inGachapon: false,
    isStarter: true,
    description: 'Cabelo ao vento.',
    icon: '✨',
    previewColor: '#64748b',
  },
  {
    id: 'head_lofi_headphones',
    name: 'Headset Lofi',
    category: 'avatar_head',
    rarity: 'COMMON',
    currency: 'COINS',
    price: 90,
    inGachapon: true,
    description: 'Fones acolchoados tocando batidas relaxantes.',
    icon: '🎧',
    previewColor: '#ec4899',
  },
  {
    id: 'head_astronaut',
    name: 'Capacete Astronauta',
    category: 'avatar_head',
    rarity: 'EPIC',
    currency: 'GEMS',
    price: 110,
    inGachapon: true,
    description: 'Visor espacial reflexivo para explorar outras telas.',
    icon: '👩‍🚀',
    previewColor: '#e2e8f0',
  },
  {
    id: 'head_wizard',
    name: 'Chapéu de Mago Estelar',
    category: 'avatar_head',
    rarity: 'RARE',
    currency: 'COINS',
    price: 160,
    inGachapon: true,
    description: 'Pontudo e bordado com constelações 8-bit.',
    icon: '🧙',
    previewColor: '#8b5cf6',
  },

  // ==========================================
  // 3. ACESSÓRIOS DE COSTAS
  // ==========================================
  {
    id: 'back_none',
    name: 'Costas Livres',
    category: 'avatar_back',
    rarity: 'COMMON',
    currency: 'COINS',
    price: 0,
    inGachapon: false,
    isStarter: true,
    description: 'Sem mochila ou capa.',
    icon: '➖',
    previewColor: '#64748b',
  },
  {
    id: 'back_jetpack',
    name: 'Mochila Jetpack',
    category: 'avatar_back',
    rarity: 'EPIC',
    currency: 'GEMS',
    price: 140,
    inGachapon: true,
    description: 'Solta faíscas propulsoras durante os pulos!',
    icon: '🚀',
    previewColor: '#ef4444',
  },
  {
    id: 'back_angel_wings',
    name: 'Asas Pixeladas',
    category: 'avatar_back',
    rarity: 'RARE',
    currency: 'COINS',
    price: 200,
    inGachapon: true,
    description: 'Pequenas asas brancas que batem suavemente.',
    icon: '🪽',
    previewColor: '#f8fafc',
  },

  // ==========================================
  // 4. EFEITOS DE ENTRADA (SPAWN FX)
  // ==========================================
  {
    id: 'fx_pop',
    name: 'Pulo Clássico',
    category: 'spawn_fx',
    rarity: 'COMMON',
    currency: 'COINS',
    price: 0,
    inGachapon: false,
    isStarter: true,
    description: 'Entrada leve com poeira pixelada.',
    icon: '💨',
    previewColor: '#94a3b8',
  },
  {
    id: 'fx_cyber_lightning',
    name: 'Raio Cyberpunk',
    category: 'spawn_fx',
    rarity: 'EPIC',
    currency: 'GEMS',
    price: 150,
    inGachapon: true,
    description: 'Um trovão neon azul e magenta rasga o cantinho na sua chegada.',
    icon: '⚡',
    previewColor: '#00f5d4',
  },
  {
    id: 'fx_parachute',
    name: 'Queda de Paraquedas',
    category: 'spawn_fx',
    rarity: 'RARE',
    currency: 'COINS',
    price: 140,
    inGachapon: true,
    description: 'Desce suavemente do topo da janela de paraquedas.',
    icon: '🪂',
    previewColor: '#fb923c',
  },
  {
    id: 'fx_cardboard_box',
    name: 'Caixa de Papelão',
    category: 'spawn_fx',
    rarity: 'RARE',
    currency: 'COINS',
    price: 130,
    inGachapon: true,
    description: 'Infiltração furtiva! A caixa se abre revelando seu avatar.',
    icon: '📦',
    previewColor: '#d97706',
  },
  {
    id: 'fx_alien_abduction',
    name: 'Abdução Alienígena',
    category: 'spawn_fx',
    rarity: 'LEGENDARY',
    currency: 'GEMS',
    price: 240,
    inGachapon: true,
    description: 'Um disco voador projeta um feixe trator verde para teletransportar você.',
    icon: '🛸',
    previewColor: '#22c55e',
  },

  // ==========================================
  // 5. BALÕES DE FALA (CHAT SKINS)
  // ==========================================
  {
    id: 'chat_default',
    name: 'Balão Pixel Clássico',
    category: 'chat_skin',
    rarity: 'COMMON',
    currency: 'COINS',
    price: 0,
    inGachapon: false,
    isStarter: true,
    description: 'Balão branco retrô com blip suave.',
    icon: '💬',
    previewColor: '#f8fafc',
    meta: { blipFreq: 520, blipWave: 'square' },
  },
  {
    id: 'chat_medieval',
    name: 'Pergaminho Medieval',
    category: 'chat_skin',
    rarity: 'RARE',
    currency: 'COINS',
    price: 120,
    inGachapon: true,
    description: 'Estética de RPG clássico com som de harpa 8-bit.',
    icon: '📜',
    previewColor: '#fde68a',
    meta: { blipFreq: 440, blipWave: 'triangle' },
  },
  {
    id: 'chat_neon',
    name: 'Placa de Neon',
    category: 'chat_skin',
    rarity: 'EPIC',
    currency: 'GEMS',
    price: 100,
    inGachapon: true,
    description: 'Borda ciano/magenta brilhante com sintetizador futurista.',
    icon: '🔮',
    previewColor: '#22d3ee',
    meta: { blipFreq: 740, blipWave: 'sawtooth' },
  },
  {
    id: 'chat_flames',
    name: 'Balão em Chamas',
    category: 'chat_skin',
    rarity: 'LEGENDARY',
    currency: 'GEMS',
    price: 180,
    inGachapon: true,
    description: 'Para mensagens urgentes! Borda flamejante animada.',
    icon: '🔥',
    previewColor: '#f97316',
    meta: { blipFreq: 330, blipWave: 'sawtooth' },
  },

  // ==========================================
  // 6. BRINQUEDOS ARREMESSÁVEIS (THROWABLES)
  // ==========================================
  {
    id: 'throw_paper_ball',
    name: 'Bolinha de Papel',
    category: 'throwable',
    rarity: 'COMMON',
    currency: 'COINS',
    price: 0,
    inGachapon: false,
    isStarter: true,
    description: 'Clássico de escritório para chamar a atenção de quem está focado.',
    icon: '🗞️',
    previewColor: '#e2e8f0',
  },
  {
    id: 'throw_gold_plane',
    name: 'Avião de Papel Dourado',
    category: 'throwable',
    rarity: 'EPIC',
    currency: 'GEMS',
    price: 110,
    inGachapon: true,
    description: 'Plana com brilho dourado deixando rastro reluzente.',
    icon: '✈️',
    previewColor: '#facc15',
  },
  {
    id: 'throw_frozen_fish',
    name: 'Peixe Congelado',
    category: 'throwable',
    rarity: 'RARE',
    currency: 'COINS',
    price: 140,
    inGachapon: true,
    description: 'Um salmão gelado giratório com impacto cômico.',
    icon: '🐟',
    previewColor: '#38bdf8',
  },
  {
    id: 'throw_glitter_bomb',
    name: 'Bomba de Glitter',
    category: 'throwable',
    rarity: 'LEGENDARY',
    currency: 'GEMS',
    price: 190,
    inGachapon: true,
    description: 'Explode em dezenas de partículas coloridas na tela do amigo!',
    icon: '🎊',
    previewColor: '#f472b6',
  },

  // ==========================================
  // 7. TEMAS DE CANTINHO (ROOM SKINS)
  // ==========================================
  {
    id: 'room_cozy_desk',
    name: 'Estúdio Lofi (Ciclo Real)',
    category: 'room_skin',
    rarity: 'COMMON',
    currency: 'COINS',
    price: 0,
    inGachapon: false,
    isStarter: true,
    description:
      'Quarto aconchegante com janela dinâmica que acompanha seu horário local (manhã clara, pôr do sol alaranjado e noite estrelada), estante e planta.',
    icon: '🏠',
    previewColor: '#312e81',
  },
  {
    id: 'room_dense_forest',
    name: 'Floresta Densa Encantada',
    category: 'room_skin',
    rarity: 'RARE',
    currency: 'COINS',
    price: 160,
    inGachapon: true,
    description: 'Árvores gigantes fechadas, cipós pendentes, cogumelos luminosos e vagalumes.',
    icon: '🌲',
    previewColor: '#14532d',
  },
  {
    id: 'room_office',
    name: 'Escritório Executivo',
    category: 'room_skin',
    rarity: 'RARE',
    currency: 'COINS',
    price: 150,
    inGachapon: true,
    description: 'Janelão corporativo com persianas, quadro branco de metas, relógio e dispenser de água.',
    icon: '🏢',
    previewColor: '#334155',
  },
  {
    id: 'room_underwater',
    name: 'Fundo do Mar (Recife)',
    category: 'room_skin',
    rarity: 'EPIC',
    currency: 'COINS',
    price: 200,
    inGachapon: true,
    description: 'Oceano profundo com raios de sol na água, corais coloridos, algas, bolhas e peixinhos.',
    icon: '🌊',
    previewColor: '#0369a1',
  },
  {
    id: 'room_rainy_rooftop',
    name: 'Cobertura Chuvosa Lofi',
    category: 'room_skin',
    rarity: 'EPIC',
    currency: 'GEMS',
    price: 160,
    inGachapon: true,
    description: 'Vista da cidade iluminada sob chuva relaxante em pixel art.',
    icon: '🌧️',
    previewColor: '#1e293b',
  },
  {
    id: 'room_forest_campfire',
    name: 'Fogueira na Floresta',
    category: 'room_skin',
    rarity: 'RARE',
    currency: 'COINS',
    price: 220,
    inGachapon: true,
    description: 'Acampamento noturno com pinheiros, vagalumes e fogueira crepitante.',
    icon: '🏕️',
    previewColor: '#064e3b',
  },
  {
    id: 'room_moving_train',
    name: 'Vagão de Trem em Movimento',
    category: 'room_skin',
    rarity: 'LEGENDARY',
    currency: 'GEMS',
    price: 260,
    inGachapon: true,
    description: 'Janelas panorâmicas com paisagem em movimento contínuo ao pôr do sol.',
    icon: '🚆',
    previewColor: '#7c2d12',
  },
  {
    id: 'room_cinema',
    name: 'Sala de Cinema VIP',
    category: 'room_skin',
    rarity: 'EPIC',
    currency: 'COINS',
    price: 240,
    inGachapon: true,
     description:
      'Telão de cinema com projeção animada que muda conforme o horário, cortinas de veludo vermelho, feixe de projetor, poltronas VIP e pipoqueira.',
    icon: '🍿',
    previewColor: '#991b1b',
  },
  {
    id: 'room_beco_rapariga',
    name: 'Beco da Rapariga',
    category: 'room_skin',
    rarity: 'LEGENDARY',
    currency: 'GEMS',
    price: 999,
    inGachapon: false,
    realMoneyOnly: true,
    packId: 'pkg_double_d',
    description:
      '👑 EXCLUSIVO DOUBLE D PACK: Cenário urbano autêntico com muro pichado em pixel art, placa icônica, arbusto de calçada e poste iluminado.',
    icon: '🪧',
    previewColor: '#7f1d1d',
  },

  // ==========================================
  // 8. PRESENTES DE MESA (DESK DROPS / AFK GIFTS)
  // ==========================================
  {
    id: 'drop_coffee',
    name: 'Café Expresso',
    category: 'desk_drop',
    rarity: 'COMMON',
    currency: 'COINS',
    price: 0,
    inGachapon: false,
    isStarter: true,
    description: 'Deixa um café fumegante no chão. Dá velocidade 2x temporária ao Host!',
    icon: '☕',
    previewColor: '#b45309',
    meta: { speedBoostSec: 20, bonusCoins: 0 },
  },
  {
    id: 'drop_rubber_duck',
    name: 'Pato de Borracha',
    category: 'desk_drop',
    rarity: 'COMMON',
    currency: 'COINS',
    price: 0,
    inGachapon: false,
    isStarter: true,
    description: 'Ajuda no debug! Faz "Quack!" quando o Host clica nele.',
    icon: '🦆',
    previewColor: '#eab308',
    meta: { bonusCoins: 0 },
  },
  {
    id: 'drop_postit',
    name: 'Post-it com Recado',
    category: 'desk_drop',
    rarity: 'COMMON',
    currency: 'COINS',
    price: 0,
    inGachapon: false,
    isStarter: true,
    description: 'Bilhete amarelo colado no cantinho do amigo.',
    icon: '📝',
    previewColor: '#fef08a',
    meta: { bonusCoins: 0 },
  },
  {
    id: 'drop_birthday_cake',
    name: 'Bolo de Aniversário',
    category: 'desk_drop',
    rarity: 'RARE',
    currency: 'COINS',
    price: 130,
    inGachapon: true,
    description: 'Bolo confeitado com velinha acesa! Dá velocidade e chuva de confete.',
    icon: '🎂',
    previewColor: '#f43f5e',
    meta: { speedBoostSec: 15, bonusCoins: 2 },
  },
  {
    id: 'drop_sleeping_cat',
    name: 'Gato Dormindo',
    category: 'desk_drop',
    rarity: 'EPIC',
    currency: 'GEMS',
    price: 120,
    inGachapon: true,
    description: 'Um gatinho enrolado no tapete que ronrona quando recebe carinho.',
    icon: '🐈',
    previewColor: '#fb923c',
    meta: { speedBoostSec: 25, bonusCoins: 3 },
  },

  // ==========================================
  // 9. MÓVEIS DE CENÁRIO POSICIONÁVEIS (FURNITURE)
  // ==========================================
  {
    id: 'furn_gamer_setup',
    name: 'Setup Gamer RGB',
    category: 'furniture',
    rarity: 'EPIC',
    currency: 'COINS',
    price: 0,
    inGachapon: false,
    isStarter: true,
    description: 'Mesa gamer com 2 monitores, gabinete vidro com cooler RGB animado e teclado mecânico.',
    icon: '🖥️',
    previewColor: '#06b6d4',
    meta: { widthPx: 56 },
  },
  {
    id: 'furn_gamer_chair',
    name: 'Cadeira Gamer Pro',
    category: 'furniture',
    rarity: 'RARE',
    currency: 'COINS',
    price: 0,
    inGachapon: false,
    isStarter: true,
    description: 'Cadeira ergonômica estilo racing com cor personalizável e rodinhas.',
    icon: '🪑',
    previewColor: '#ef4444',
    meta: { widthPx: 26 },
  },
  {
    id: 'furn_dining_table',
    name: 'Mesa de Jantar Posta',
    category: 'furniture',
    rarity: 'RARE',
    currency: 'COINS',
    price: 0,
    inGachapon: false,
    isStarter: true,
    description: 'Mesa de jantar com toalha personalizável, pratos, taças e vela acesa.',
    icon: '🍽️',
    previewColor: '#d97706',
    meta: { widthPx: 58 },
  },
  {
    id: 'furn_cozy_sofa',
    name: 'Sofá Lofi 2 Lugares',
    category: 'furniture',
    rarity: 'RARE',
    currency: 'COINS',
    price: 110,
    inGachapon: true,
    description: 'Sofá macio com almofadas e estofado que muda de cor na sua Mochila!',
    icon: '🛋️',
    previewColor: '#ec4899',
    meta: { widthPx: 52 },
  },
  {
    id: 'furn_cozy_rug',
    name: 'Tapete Felpudo',
    category: 'furniture',
    rarity: 'COMMON',
    currency: 'COINS',
    price: 80,
    inGachapon: true,
    description: 'Tapete aconchegante com franjas nas bordas e cor personalizável.',
    icon: '🧶',
    previewColor: '#eab308',
    meta: { widthPx: 70 },
  },
  {
    id: 'furn_wall_frames',
    name: 'Galeria de Quadros',
    category: 'furniture',
    rarity: 'COMMON',
    currency: 'COINS',
    price: 90,
    inGachapon: true,
    description: 'Trio de quadros pixel art pendurados na parede com moldura e arte personalizáveis.',
    icon: '🖼️',
    previewColor: '#38bdf8',
    meta: { widthPx: 48 },
  },
  {
    id: 'furn_floor_lamp',
    name: 'Luminária de Piso',
    category: 'furniture',
    rarity: 'RARE',
    currency: 'COINS',
    price: 100,
    inGachapon: true,
    description: 'Luminária alta que projeta um feixe de luz acolhedor na cor que você escolher.',
    icon: '💡',
    previewColor: '#facc15',
    meta: { widthPx: 22 },
  },
  {
    id: 'furn_bookshelf',
    name: 'Estante & Plantas',
    category: 'furniture',
    rarity: 'RARE',
    currency: 'COINS',
    price: 130,
    inGachapon: true,
    description: 'Estante de madeira com coleção de livros coloridos e hera pendente.',
    icon: '📚',
    previewColor: '#92400e',
    meta: { widthPx: 40 },
  },
  {
    id: 'furn_aquarium',
    name: 'Aquário Iluminado',
    category: 'furniture',
    rarity: 'EPIC',
    currency: 'COINS',
    price: 160,
    inGachapon: true,
    description: 'Aquário panorâmico sobre gabinete com peixinhos nadando e bolhas.',
    icon: '🐠',
    previewColor: '#06b6d4',
    meta: { widthPx: 42 },
  },
  {
    id: 'furn_arcade_cabinet',
    name: 'Fliperama Arcade 90s',
    category: 'furniture',
    rarity: 'EPIC',
    currency: 'COINS',
    price: 160,
    inGachapon: true,
    description: 'Máquina de fliperama clássica com tela animada e controles neon.',
    icon: '🕹️',
    previewColor: '#a855f7',
    meta: { widthPx: 32 },
  },
  {
    id: 'furn_mini_fridge',
    name: 'Frigobar RGB',
    category: 'furniture',
    rarity: 'EPIC',
    currency: 'GEMS',
    price: 110,
    inGachapon: true,
    description: 'Mini geladeira com porta de vidro iluminada cheia de energéticos e cafés.',
    icon: '🧊',
    previewColor: '#22d3ee',
    meta: { widthPx: 26 },
  },
  {
    id: 'furn_sakura_bonsai',
    name: 'Bonsai de Sakura',
    category: 'furniture',
    rarity: 'LEGENDARY',
    currency: 'GEMS',
    price: 150,
    inGachapon: true,
    description: 'Árvore bonsai de cerejeira japonesa em vaso cerâmico.',
    icon: '🌸',
    previewColor: '#f472b6',
    meta: { widthPx: 30 },
  },
  {
    id: 'furn_coffee_machine',
    name: 'Estação de Café Expresso',
    category: 'furniture',
    rarity: 'RARE',
    currency: 'COINS',
    price: 90,
    inGachapon: true,
    isStarter: true,
    description:
      'Bancada de barista com cafeteira expresso italiana soltando vaporzinho e canecas penduradas. O Pip vai até ela preparar café!',
    icon: '☕',
    previewColor: '#b45309',
    meta: { widthPx: 32 },
  },
  {
    id: 'furn_pet_bed',
    name: 'Caminha Pet & Pufe',
    category: 'furniture',
    rarity: 'RARE',
    currency: 'COINS',
    price: 95,
    inGachapon: true,
    isStarter: true,
    description:
      'Caminha/pufe redondo ultra macio com almofada personalizável onde seu Pip adora tirar um cochilo durante o dia.',
    icon: '🛏️',
    previewColor: '#a855f7',
    meta: { widthPx: 38 },
  },
  {
    id: 'furn_monstera_plant',
    name: 'Vaso Costela-de-Adão',
    category: 'furniture',
    rarity: 'COMMON',
    currency: 'COINS',
    price: 75,
    inGachapon: true,
    isStarter: true,
    description:
      'Planta Costela-de-Adão em vaso de cerâmica com folhas largas que balançam suavemente.',
    icon: '🪴',
    previewColor: '#10b981',
    meta: { widthPx: 26 },
  },
  {
    id: 'furn_dj_booth',
    name: 'Mesa de DJ Double D',
    category: 'furniture',
    rarity: 'LEGENDARY',
    currency: 'GEMS',
    price: 999,
    inGachapon: false,
    realMoneyOnly: true,
    packId: 'pkg_double_d',
    description:
      '👑 EXCLUSIVO DOUBLE D PACK: Mesa de DJ completa com toca-discos giratórios duplos, mixer iluminado, subwoofers e painel LED equalizador animado!',
    icon: '🎛️',
    previewColor: '#facc15',
    meta: { widthPx: 62 },
  },

  // ==========================================
  // 10. PETS COMPANHEIROS (TODOS EM DIAMANTES 💎)
  // Apenas 1 equipado por vez • Raças personalizáveis após a compra
  // ==========================================
  {
    id: 'pet_cat',
    name: 'Gatinho Companheiro',
    category: 'companion_pet',
    rarity: 'RARE',
    currency: 'GEMS',
    price: 99,
    inGachapon: false,
    description:
      'Miau! Um gatinho carinhoso que caminha ao seu lado no cantinho. Inclui 6 raças personalizáveis (Siamês, Laranja, Pretinho, Persa, Frajola e Tricolor)!',
    icon: '🐱',
    previewColor: '#f59e0b',
  },
  {
    id: 'pet_dog',
    name: 'Cachorrinho Fiel',
    category: 'companion_pet',
    rarity: 'RARE',
    currency: 'GEMS',
    price: 99,
    inGachapon: false,
    description:
      'Seu melhor amigo de expediente com rabinho abanando! Escolha livremente entre 6 raças (Caramelo, Golden, Husky, Pug, Shiba Inu e Dálmata).',
    icon: '🐶',
    previewColor: '#d97706',
  },
  {
    id: 'pet_dragon',
    name: 'Dragão Guardião Ancestral',
    category: 'companion_pet',
    rarity: 'LEGENDARY',
    currency: 'GEMS',
    price: 420,
    inGachapon: false,
    description:
      '🐉 COLOSSAL: Um imponente dragão alado MAIOR que os outros pets e maior que o próprio Pip! Escolha entre 5 linhagens elementais (Rubi de Fogo, Glacial, Esmeralda, Obsidiana e Celestial Dourado).',
    icon: '🐉',
    previewColor: '#ef4444',
  },
  {
    id: 'pet_dino',
    name: 'Dinossauro Pré-Histórico',
    category: 'companion_pet',
    rarity: 'EPIC',
    currency: 'GEMS',
    price: 230,
    inGachapon: false,
    description:
      'Direto do Jurássico para a sua mesa de trabalho! Personalize entre 5 espécies/raças (T-Rex Verde, Triceratops Azul, Velociraptor Laranja, Estegossauro Roxo e T-Rex Albino).',
    icon: '🦖',
    previewColor: '#16a34a',
  },
  {
    id: 'pet_fox',
    name: 'Raposinha Astuta',
    category: 'companion_pet',
    rarity: 'RARE',
    currency: 'GEMS',
    price: 89,
    inGachapon: false,
    description:
      'Rabo felpudo e orelhinhas atentas! Personalize entre 5 raças (Raposa Vermelha, Ártica Branca, Fennec do Deserto, Prateada e Kitsune Dourada).',
    icon: '🦊',
    previewColor: '#ea580c',
  },
  {
    id: 'pet_bunny',
    name: 'Coelhinho Saltitante',
    category: 'companion_pet',
    rarity: 'RARE',
    currency: 'GEMS',
    price: 89,
    inGachapon: false,
    description:
      'Dá pulinhos fofos enquanto acompanha seu foco! Escolha entre 5 raças (Neve, Lop Caramelo, Holandês Malhado, Chinchila e Algodão-Doce).',
    icon: '🐰',
    previewColor: '#f472b6',
  },
  {
    id: 'pet_owl',
    name: 'Corujinha Sábia',
    category: 'companion_pet',
    rarity: 'EPIC',
    currency: 'GEMS',
    price: 89,
    inGachapon: false,
    description:
      'Companheira noturna de estudos e código! Escolha entre 4 raças (Coruja-das-Neves, Buraqueira Marrom, Real Dourada e Cósmica Estelar).',
    icon: '🦉',
    previewColor: '#8b5cf6',
  },
  {
    id: 'pet_capybara',
    name: 'Capivara Zen',
    category: 'companion_pet',
    rarity: 'EPIC',
    currency: 'GEMS',
    price: 85,
    inGachapon: false,
    description:
      'Paz absoluta no expediente com uma tangerina na cabeça! Escolha entre 4 variações (Clássica com Laranja, Termas Onsen, Dourada Real e Chocolate).',
    icon: '🦫',
    previewColor: '#92400e',
  },
  {
    id: 'pet_panda',
    name: 'Ursinho Companheiro',
    category: 'companion_pet',
    rarity: 'EPIC',
    currency: 'GEMS',
    price: 78,
    inGachapon: false,
    description:
      'Fofinho e redondo para acompanhar seu dia! Escolha entre 5 raças de ursinhos (Panda Gigante, Panda Vermelho, Urso Polar, Urso Pardo e Panda Sakura).',
    icon: '🐼',
    previewColor: '#10b981',
  },
];

// ==========================================
// 10. PACOTES EM DINHEIRO REAL (MERCADO PAGO PIX)
// Validados estritamente no servidor!
// ==========================================
export const REAL_MONEY_PACKAGES: RealMoneyPackage[] = [
  {
    id: 'pkg_double_d',
    name: 'Double D Pack (Exclusivo)',
    subtitle: '👑 Skin Lendária DJ + Cenário Beco da Rapariga + Mesa de DJ',
    description:
      'O pacote mais deslumbrante do Pocket Corner! Inclui a Skin Lendária DJ Double D (com aura neon e equalizador animado), o cenário urbano Beco da Rapariga e a Mesa de DJ animada. Vendido APENAS em dinheiro real!',
    icon: '🎧',
    badgeText: 'EXCLUSIVO VIP',
    priceBrl: 19.9,
    type: 'EXCLUSIVE_BUNDLE',
    grantedItemIds: ['body_dj_double_d', 'room_beco_rapariga', 'furn_dj_booth'],
  },
  {
    id: 'pkg_gems_p',
    name: 'Pacote P de Pip Diamantes',
    subtitle: '100 Pip Diamantes 💎',
    description: 'Pacote inicial com 100 Pip Diamantes para desbloquear itens especiais na loja.',
    icon: '💎',
    priceBrl: 5.0,
    type: 'GEMS_PACK',
    gemsAmount: 100,
    bonusGems: 0,
  },
  {
    id: 'pkg_gems_m',
    name: 'Pacote M de Pip Diamantes',
    subtitle: '325 Pip Diamantes 💎 (+25 de bônus)',
    description: 'Receba 300 + 25 Pip Diamantes de bônus! Ideal para personalizar seu Pip e cantinho.',
    icon: '💎',
    badgeText: '+25 BÔNUS',
    priceBrl: 15.0,
    type: 'GEMS_PACK',
    gemsAmount: 325,
    bonusGems: 25,
  },
  {
    id: 'pkg_gems_g',
    name: 'Pacote G de Pip Diamantes',
    subtitle: '700 Pip Diamantes 💎 (+100 de bônus)',
    description: 'Baú recheado com 600 + 100 Pip Diamantes de bônus! O melhor custo-benefício.',
    icon: '💎',
    badgeText: '+100 BÔNUS • MELHOR VALOR',
    priceBrl: 30.0,
    type: 'GEMS_PACK',
    gemsAmount: 700,
    bonusGems: 100,
  },
  {
    id: 'pkg_coins_p',
    name: 'Pacote P de Moedas',
    subtitle: '250 Moedas 🪙',
    description: 'Saco com 250 Moedas para comprar móveis, cenários e skins de moedas imediatamente sem esperar!',
    icon: '🪙',
    priceBrl: 5.0,
    type: 'COINS_PACK',
    coinsAmount: 250,
    bonusCoins: 0,
  },
  {
    id: 'pkg_coins_m',
    name: 'Pacote M de Moedas',
    subtitle: '700 Moedas 🪙 (+100 de bônus)',
    description: 'Receba 600 + 100 Moedas de bônus para mobiliar e personalizar todo o seu cantinho!',
    icon: '🪙',
    badgeText: '+100 BÔNUS',
    priceBrl: 12.0,
    type: 'COINS_PACK',
    coinsAmount: 700,
    bonusCoins: 100,
  },
  {
    id: 'pkg_coins_g',
    name: 'Pacote G de Moedas',
    subtitle: '1.500 Moedas 🪙 (+400 de bônus)',
    description: 'Baú dourado com 1.100 + 400 Moedas de bônus! O melhor custo-benefício em moedas.',
    icon: '🪙',
    badgeText: '+400 BÔNUS • MELHOR VALOR',
    priceBrl: 22.0,
    type: 'COINS_PACK',
    coinsAmount: 1500,
    bonusCoins: 400,
  },
  // {
  //   id: 'pkg_test_1cent',
  //   name: 'Item Teste (1 Centavo)',
  //   subtitle: '1 Pip Diamante 💎 (Teste PIX Real)',
  //   description: 'Pacote de R$ 0,01 (1 centavo) para testar a integração real com o Mercado Pago.',
  //   icon: '🧪',
  //   badgeText: 'TESTE R$ 0,01',
  //   priceBrl: 0.01,
  //   type: 'GEMS_PACK',
  //   gemsAmount: 1,
  //   bonusGems: 0,
  //   isTestItem: true,
  // },
];

export const CATALOG_BY_ID = new Map<string, CosmeticItem>(
  COSMETIC_CATALOG.map((item) => [item.id, item])
);

export const REAL_MONEY_PACKAGES_BY_ID = new Map<string, RealMoneyPackage>(
  REAL_MONEY_PACKAGES.map((pkg) => [pkg.id, pkg])
);

export const STARTER_INVENTORY_IDS: string[] = COSMETIC_CATALOG.filter(
  (item) => item.isStarter
).map((item) => item.id);

export function getCosmeticById(itemId: string): CosmeticItem | undefined {
  return CATALOG_BY_ID.get(itemId);
}

export function getRealMoneyPackageById(pkgId: string): RealMoneyPackage | undefined {
  return REAL_MONEY_PACKAGES_BY_ID.get(pkgId);
}

// ==========================================
// 11. RAÇAS / VARIAÇÕES DOS PETS COMPANHEIROS
// Escolhidas livremente pelo dono após adquirir o pet!
// ==========================================
export interface PetBreedOption {
  id: string;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  eyeColor: string;
}

export const PET_BREED_OPTIONS: Record<string, PetBreedOption[]> = {
  pet_cat: [
    { id: 'siamese', name: 'Siamês Real', primaryColor: '#f5ebe0', secondaryColor: '#4a3525', accentColor: '#38bdf8', eyeColor: '#0ea5e9' },
    { id: 'orange', name: 'Laranja Tigrado', primaryColor: '#f59e0b', secondaryColor: '#b45309', accentColor: '#fef3c7', eyeColor: '#16a34a' },
    { id: 'black', name: 'Pretinho da Sorte', primaryColor: '#1e293b', secondaryColor: '#0f172a', accentColor: '#f43f5e', eyeColor: '#facc15' },
    { id: 'white', name: 'Persa Branco', primaryColor: '#f8fafc', secondaryColor: '#e2e8f0', accentColor: '#f472b6', eyeColor: '#38bdf8' },
    { id: 'tuxedo', name: 'Frajola (Smoking)', primaryColor: '#1e293b', secondaryColor: '#ffffff', accentColor: '#fb7185', eyeColor: '#22c55e' },
    { id: 'calico', name: 'Tricolor Calico', primaryColor: '#ffffff', secondaryColor: '#ea580c', accentColor: '#1e293b', eyeColor: '#ca8a04' },
  ],
  pet_dog: [
    { id: 'caramelo', name: 'Vira-lata Caramelo', primaryColor: '#d97706', secondaryColor: '#92400e', accentColor: '#ef4444', eyeColor: '#1e1b18' },
    { id: 'golden', name: 'Golden Retriever', primaryColor: '#fbbf24', secondaryColor: '#d97706', accentColor: '#3b82f6', eyeColor: '#1e1b18' },
    { id: 'husky', name: 'Husky Siberiano', primaryColor: '#475569', secondaryColor: '#f8fafc', accentColor: '#06b6d4', eyeColor: '#38bdf8' },
    { id: 'pug', name: 'Pug Fofinho', primaryColor: '#e7d5b8', secondaryColor: '#292524', accentColor: '#ec4899', eyeColor: '#1e1b18' },
    { id: 'shiba', name: 'Shiba Inu', primaryColor: '#ea580c', secondaryColor: '#fef3c7', accentColor: '#16a34a', eyeColor: '#1e1b18' },
    { id: 'dalmatian', name: 'Dálmata Pintado', primaryColor: '#f8fafc', secondaryColor: '#0f172a', accentColor: '#dc2626', eyeColor: '#1e1b18' },
  ],
  pet_dragon: [
    { id: 'fire_ruby', name: 'Rubi de Fogo', primaryColor: '#dc2626', secondaryColor: '#f59e0b', accentColor: '#fef08a', eyeColor: '#facc15' },
    { id: 'ice_frost', name: 'Dragão Glacial', primaryColor: '#0284c7', secondaryColor: '#bae6fd', accentColor: '#e0f2fe', eyeColor: '#38bdf8' },
    { id: 'emerald', name: 'Esmeralda Ancestral', primaryColor: '#059669', secondaryColor: '#a7f3d0', accentColor: '#fbbf24', eyeColor: '#fde047' },
    { id: 'shadow_obsidian', name: 'Obsidiana Sombrio', primaryColor: '#1e1b4b', secondaryColor: '#7c3aed', accentColor: '#c084fc', eyeColor: '#e879f9' },
    { id: 'golden_celestial', name: 'Celestial Dourado', primaryColor: '#eab308', secondaryColor: '#fef9c3', accentColor: '#f97316', eyeColor: '#38bdf8' },
  ],
  pet_dino: [
    { id: 'trex_green', name: 'T-Rex Verde', primaryColor: '#16a34a', secondaryColor: '#86efac', accentColor: '#dc2626', eyeColor: '#facc15' },
    { id: 'triceratops_blue', name: 'Triceratops Azul', primaryColor: '#2563eb', secondaryColor: '#93c5fd', accentColor: '#f8fafc', eyeColor: '#fde047' },
    { id: 'raptor_orange', name: 'Velociraptor Laranja', primaryColor: '#ea580c', secondaryColor: '#fed7aa', accentColor: '#7c2d12', eyeColor: '#bef264' },
    { id: 'stego_purple', name: 'Estegossauro Roxo', primaryColor: '#7c3aed', secondaryColor: '#ddd6fe', accentColor: '#f43f5e', eyeColor: '#fde047' },
    { id: 'trex_albino', name: 'T-Rex Albino Real', primaryColor: '#f1f5f9', secondaryColor: '#cbd5e1', accentColor: '#ef4444', eyeColor: '#ef4444' },
  ],
  pet_fox: [
    { id: 'red_fox', name: 'Raposa Vermelha', primaryColor: '#ea580c', secondaryColor: '#ffffff', accentColor: '#1e293b', eyeColor: '#ca8a04' },
    { id: 'arctic_fox', name: 'Raposa do Ártico', primaryColor: '#f8fafc', secondaryColor: '#bae6fd', accentColor: '#64748b', eyeColor: '#0ea5e9' },
    { id: 'fennec_fox', name: 'Raposa Fennec', primaryColor: '#fde68a', secondaryColor: '#fffbeb', accentColor: '#b45309', eyeColor: '#1e1b18' },
    { id: 'silver_fox', name: 'Raposa Prateada', primaryColor: '#334155', secondaryColor: '#e2e8f0', accentColor: '#0f172a', eyeColor: '#facc15' },
    { id: 'kitsune_gold', name: 'Kitsune Mística', primaryColor: '#fbbf24', secondaryColor: '#fff7ed', accentColor: '#ef4444', eyeColor: '#dc2626' },
  ],
  pet_bunny: [
    { id: 'white_snow', name: 'Branquinho Neve', primaryColor: '#ffffff', secondaryColor: '#fbcfe8', accentColor: '#f43f5e', eyeColor: '#ec4899' },
    { id: 'caramel_lop', name: 'Lop Caramelo', primaryColor: '#d97706', secondaryColor: '#fef3c7', accentColor: '#92400e', eyeColor: '#1e1b18' },
    { id: 'dutch_panda', name: 'Holandês Malhado', primaryColor: '#1e293b', secondaryColor: '#ffffff', accentColor: '#f472b6', eyeColor: '#1e1b18' },
    { id: 'chinchilla_grey', name: 'Cinza Chinchila', primaryColor: '#94a3b8', secondaryColor: '#f1f5f9', accentColor: '#fda4af', eyeColor: '#1e1b18' },
    { id: 'pastel_pink', name: 'Algodão-Doce Rosa', primaryColor: '#f9a8d4', secondaryColor: '#fdf2f8', accentColor: '#ec4899', eyeColor: '#831843' },
  ],
  pet_owl: [
    { id: 'snowy_owl', name: 'Coruja-das-Neves', primaryColor: '#f8fafc', secondaryColor: '#cbd5e1', accentColor: '#475569', eyeColor: '#facc15' },
    { id: 'barn_brown', name: 'Buraqueira Marrom', primaryColor: '#92400e', secondaryColor: '#fde68a', accentColor: '#78350f', eyeColor: '#fbbf24' },
    { id: 'golden_eagle_owl', name: 'Coruja Real Dourada', primaryColor: '#d97706', secondaryColor: '#fef08a', accentColor: '#451a03', eyeColor: '#f97316' },
    { id: 'cosmic_night', name: 'Coruja Cósmica', primaryColor: '#312e81', secondaryColor: '#c084fc', accentColor: '#38bdf8', eyeColor: '#fde047' },
  ],
  pet_capybara: [
    { id: 'classic_orange', name: 'Clássica com Laranja', primaryColor: '#92400e', secondaryColor: '#78350f', accentColor: '#f97316', eyeColor: '#1e1b18' },
    { id: 'onsen_towel', name: 'Termas Onsen', primaryColor: '#a16207', secondaryColor: '#713f12', accentColor: '#ffffff', eyeColor: '#1e1b18' },
    { id: 'golden_capy', name: 'Capivara Dourada', primaryColor: '#eab308', secondaryColor: '#ca8a04', accentColor: '#ef4444', eyeColor: '#1e1b18' },
    { id: 'choco_capy', name: 'Capivara Chocolate', primaryColor: '#451a03', secondaryColor: '#270e02', accentColor: '#22c55e', eyeColor: '#1e1b18' },
  ],
  pet_panda: [
    { id: 'giant_panda', name: 'Panda Gigante', primaryColor: '#ffffff', secondaryColor: '#0f172a', accentColor: '#22c55e', eyeColor: '#ffffff' },
    { id: 'red_panda', name: 'Panda Vermelho', primaryColor: '#dc2626', secondaryColor: '#451a03', accentColor: '#ffffff', eyeColor: '#1e1b18' },
    { id: 'polar_bear', name: 'Urso Polar', primaryColor: '#f8fafc', secondaryColor: '#e2e8f0', accentColor: '#38bdf8', eyeColor: '#0f172a' },
    { id: 'grizzly_bear', name: 'Urso Pardo Grizzly', primaryColor: '#78350f', secondaryColor: '#451a03', accentColor: '#d97706', eyeColor: '#1e1b18' },
    { id: 'sakura_panda', name: 'Panda Sakura Rosa', primaryColor: '#fdf2f8', secondaryColor: '#ec4899', accentColor: '#f43f5e', eyeColor: '#ffffff' },
  ],
};

export function getPetBreedOption(petId: string, variantId?: string): PetBreedOption {
  const breeds = PET_BREED_OPTIONS[petId] || [
    { id: 'default', name: 'Clássico', primaryColor: '#f59e0b', secondaryColor: '#78350f', accentColor: '#ef4444', eyeColor: '#1e1b18' },
  ];
  if (variantId) {
    const found = breeds.find((b) => b.id === variantId);
    if (found) return found;
  }
  return breeds[0];
}

// ==========================================
// 12. PERSONALIZAÇÃO GRATUITA DO HUMANO COZY (TOM DE PELE + COR DA ROUPA)
// ==========================================
export interface HumanSkinToneOption {
  id: string;
  name: string;
  skinColor: string;
  hairColor: string;
}

export interface HumanHoodieColorOption {
  id: string;
  name: string;
  primaryColor: string;
  secondaryColor: string;
}

export const HUMAN_SKIN_TONES: HumanSkinToneOption[] = [
  { id: 'peach', name: 'Pêssego', skinColor: '#fed7aa', hairColor: '#312e81' },
  { id: 'fair', name: 'Clara', skinColor: '#ffedd5', hairColor: '#92400e' },
  { id: 'warm', name: 'Trigo', skinColor: '#f1c27d', hairColor: '#27170c' },
  { id: 'tan', name: 'Canela', skinColor: '#c68642', hairColor: '#1c1917' },
  { id: 'brown', name: 'Cacau', skinColor: '#8d5524', hairColor: '#0f172a' },
  { id: 'ebony', name: 'Ébano', skinColor: '#4a2c18', hairColor: '#090d16' },
];

export const HUMAN_HOODIE_COLORS: HumanHoodieColorOption[] = [
  { id: 'indigo', name: 'Índigo', primaryColor: '#6366f1', secondaryColor: '#4338ca' },
  { id: 'emerald', name: 'Menta', primaryColor: '#10b981', secondaryColor: '#047857' },
  { id: 'crimson', name: 'Rubi', primaryColor: '#ef4444', secondaryColor: '#b91c1c' },
  { id: 'ocean', name: 'Oceano', primaryColor: '#0ea5e9', secondaryColor: '#0369a1' },
  { id: 'amber', name: 'Mostarda', primaryColor: '#f59e0b', secondaryColor: '#b45309' },
  { id: 'purple', name: 'Lavanda', primaryColor: '#8b5cf6', secondaryColor: '#6d28d9' },
  { id: 'pink', name: 'Sakura', primaryColor: '#ec4899', secondaryColor: '#be185d' },
  { id: 'dark', name: 'Ônix', primaryColor: '#1e293b', secondaryColor: '#0f172a' },
];

export function parseHumanVariant(variantStr?: string): {
  skin: HumanSkinToneOption;
  hoodie: HumanHoodieColorOption;
  variantId: string;
} {
  const parts = (variantStr || '').split(':').map((s) => s.trim());
  const firstPart = parts[0] || '';
  const secondPart = parts[1] || '';

  const foundSkin =
    HUMAN_SKIN_TONES.find((s) => s.id === firstPart) ||
    HUMAN_SKIN_TONES.find((s) => s.id === secondPart) ||
    HUMAN_SKIN_TONES[0];

  const foundHoodie =
    HUMAN_HOODIE_COLORS.find((h) => h.id === secondPart) ||
    HUMAN_HOODIE_COLORS.find((h) => h.id === firstPart) ||
    HUMAN_HOODIE_COLORS[0];

  return {
    skin: foundSkin,
    hoodie: foundHoodie,
    variantId: `${foundSkin.id}:${foundHoodie.id}`,
  };
}

// ==========================================
// 13. PERSONALIZAÇÃO DE CORES DO PEIXINHO TROPICAL (body_fish)
// ==========================================
export interface FishColorOption {
  id: string;
  name: string;
  bodyColor: string;
  stripeColor: string;
  finColor: string;
}

export const FISH_COLOR_OPTIONS: FishColorOption[] = [
  { id: 'tropical_blue', name: 'Tropical Azul', bodyColor: '#0ea5e9', stripeColor: '#f97316', finColor: '#facc15' },
  { id: 'clown_orange', name: 'Peixe-Palhaço', bodyColor: '#f97316', stripeColor: '#ffffff', finColor: '#1e293b' },
  { id: 'goldfish', name: 'Dourado Real', bodyColor: '#eab308', stripeColor: '#fef08a', finColor: '#f97316' },
  { id: 'betta_ruby', name: 'Betta Rubi', bodyColor: '#e11d48', stripeColor: '#fda4af', finColor: '#9f1239' },
  { id: 'neon_purple', name: 'Neon Roxo', bodyColor: '#8b5cf6', stripeColor: '#22d3ee', finColor: '#f472b6' },
  { id: 'emerald_reef', name: 'Esmeralda', bodyColor: '#10b981', stripeColor: '#fde047', finColor: '#059669' },
  { id: 'koi_calico', name: 'Carpa Koi', bodyColor: '#f8fafc', stripeColor: '#ef4444', finColor: '#f59e0b' },
  { id: 'abyss_cyan', name: 'Bioluminescente', bodyColor: '#0f172a', stripeColor: '#00f5d4', finColor: '#38bdf8' },
];

export function getFishColorOption(variantId?: string): FishColorOption {
  if (variantId) {
    const found = FISH_COLOR_OPTIONS.find((f) => f.id === variantId);
    if (found) return found;
  }
  return FISH_COLOR_OPTIONS[0];
}



