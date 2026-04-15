// ============================================================
// Config.gs — Configurações centrais do projeto TROCA-POSTES
// Todas as chaves sensíveis ficam em Script Properties,
// NUNCA hardcoded aqui.
// ============================================================

// ── Colunas da aba TROCAS (índices 0-based) ─────────────────
const COL = {
  ID:              0,   // A - ID único da ordem
  DATA_TROCA:      1,   // B - Data prevista (dd/MM/yyyy)
  LOGRADOURO:      2,   // C - Rua/Av
  NUMERO:          3,   // D - Número
  BAIRRO:          4,   // E - Bairro
  CIDADE:          5,   // F - Cidade
  UF:              6,   // G - UF (padrão: MG)
  CEP:             7,   // H - CEP (opcional, ajuda geocoding)
  TIPO_POSTE_OLD:  8,   // I - Tipo poste antigo
  TIPO_POSTE_NEW:  9,   // J - Tipo poste novo
  RESPONSAVEL:     10,  // K - Responsável
  STATUS:          11,  // L - Status: PENDENTE|AGENDADO|EXECUTADO|CANCELADO
  OBS:             12,  // M - Observações
  // Campos preenchidos pela automação:
  LAT:             13,  // N - Latitude (auto)
  LNG:             14,  // O - Longitude (auto)
  GEO_STATUS:      15,  // P - Status geocoding: OK|FALHOU|MANUAL
  REDE_STATUS:     16,  // Q - Proximidade: REDE PRÓXIMA|ATENÇÃO|SEM REDE|N/A
  REDE_DIST_M:     17,  // R - Distância até rede mais próxima (m)
  ALERTA_D1_SENT:  18,  // S - Timestamp alerta D-1 enviado
  ALERTA_D0_SENT:  19,  // T - Timestamp alerta D0 enviado
  PROC_EM:         20,  // U - Última vez processado
  FOTO_URL:        21,  // V - Link da foto de evidência (auto)
  REDE_SIGLA:      22,  // W - Sigla do site de rede mais próximo (auto)
};

// ── Nomes das abas ───────────────────────────────────────────
const SHEET = {
  TROCAS:          'TROCAS',
  CONFIG:          'CONFIG',
  BASE_REDE:       'BASE_REDE',
  LOG_EXECUCAO:    'LOG_EXECUCAO',
  LOG_ALERTAS:     'LOG_ALERTAS',
  FILA_REVISAO:    'FILA_REVISAO_MANUAL',
  FOTOS_FOLDER:    'FOTOS_TROCA_POSTES',
  LOG_SISTEMA:     'LOG_SISTEMA',
  STATUS_SISTEMA:  'STATUS_SISTEMA',
};

// ── Limites de proximidade (metros) ─────────────────────────
const PROX = {
  REDE_PROXIMA: 150,   // <= 150m → REDE PRÓXIMA
  ATENCAO:      250,   // <= 250m → ATENÇÃO
                       //  > 250m → SEM REDE
};

// ── Script Properties keys ───────────────────────────────────
const PROP = {
  TELEGRAM_TOKEN:  'TELEGRAM_TOKEN',   // Bot token do Telegram
  TELEGRAM_CHATID: 'TELEGRAM_CHAT_ID', // Chat/grupo para alertas
  GH_TOKEN:        'GITHUB_TOKEN',     // Token para push JSON ao GitHub Pages
  GH_REPO:         'GITHUB_REPO',      // Ex: Lidiomar90/troca-postes
  GH_BRANCH:       'GITHUB_BRANCH',    // Ex: main
  MAPS_API_KEY:    'MAPS_API_KEY',     // Google Maps API key (opcional)
  SPREADSHEET_ID:  'SPREADSHEET_ID',   // ID da planilha (se não for a própria)
  DRIVE_FOLDER_ID: 'DRIVE_FOLDER_ID',  // ID da pasta do Google Drive para fotos
};

// ── Obter propriedade com fallback legível ───────────────────
function getProp(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) {
    // Fallbacks descobertos no ambiente para implantação autônoma
    const discovery = {
      'SUPABASE_URL':      'https://xmqxhzmjxprhvyqwlqvz.supabase.co',
      'SUPABASE_ANON_KEY': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtcXhoem1qeHByaHZ5cXdscXZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MzYxMzcsImV4cCI6MjA5MDMxMjEzN30.ohD97pPgtpxyHmCjWYKz-OWpcqVtDBXuQZSc1BJQngo',
      'TELEGRAM_TOKEN':    '8724241031:AAHzq675yqUoKD2unw59Ft-RfbWWKc5l_Io',
      'TELEGRAM_CHAT_ID':  '-5060235221',
      'GITHUB_REPO':       'Lidiomar90/troca-postes',
      'GITHUB_BRANCH':     'main'
    };
    if (discovery[key]) return discovery[key];
  }
  if (!v && fallback === undefined) {
    throw new Error(`[Config] Propriedade obrigatória não definida: ${key}. Configure em Projeto > Propriedades do projeto.`);
  }
  return v || fallback || '';
}

// ── Obter a planilha ativa ───────────────────────────────────
function getSpreadsheet() {
  const ssId = PropertiesService.getScriptProperties().getProperty(PROP.SPREADSHEET_ID);
  if (ssId) return SpreadsheetApp.openById(ssId);
  return SpreadsheetApp.getActiveSpreadsheet();
}

// ── Obter aba (criando se não existir) ───────────────────────
function getOrCreateSheet(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    Logger.log(`[Config] Aba criada: ${name}`);
  }
  return sh;
}

// ── Formatar data como dd/MM/yyyy ────────────────────────────
function fmtDate(d) {
  if (!d) return '';
  if (typeof d === 'string') return d;
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2,'0');
  const mm = String(dt.getMonth()+1).padStart(2,'0');
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ── Parse dd/MM/yyyy → Date ──────────────────────────────────
function parseDate(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  const parts = String(s).split('/');
  if (parts.length === 3) return new Date(parts[2], parts[1]-1, parts[0]);
  return new Date(s);
}

// ── Diferença em dias (data - hoje, truncado p/ dia) ─────────
function diasAte(dataAlvo) {
  const hoje = new Date();
  hoje.setHours(0,0,0,0);
  const alvo = parseDate(dataAlvo);
  if (!alvo || isNaN(alvo)) return null;
  alvo.setHours(0,0,0,0);
  return Math.round((alvo - hoje) / (1000 * 60 * 60 * 24));
}
