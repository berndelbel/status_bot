import 'dotenv/config';
import { log } from './logger.js';

function str(key, fallback = undefined) {
  const v = process.env[key];
  if (v === undefined || v.trim() === '') return fallback;
  return v.trim();
}

function int(key, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = str(key);
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) {
    log.warn(`${key}="${raw}" ist keine Zahl - benutze Standardwert ${fallback}`);
    return fallback;
  }
  if (n < min) {
    log.warn(`${key}=${n} ist zu klein - wird auf ${min} angehoben`);
    return min;
  }
  if (n > max) {
    log.warn(`${key}=${n} ist zu gross - wird auf ${max} begrenzt`);
    return max;
  }
  return n;
}

function bool(key, fallback) {
  const raw = str(key);
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'ja', 'on'].includes(raw.toLowerCase());
}

/**
 * Liest eine optionale Bild-URL. Discord akzeptiert nur absolute http(s)-URLs -
 * ein relativer Pfad oder Tippfehler wuerde sonst die gesamte Embed-Validierung
 * kippen und damit die komplette Status-Nachricht verhindern. Deshalb hier
 * pruefen, warnen und im Zweifel weglassen.
 */
function imageUrl(key) {
  const raw = str(key);
  if (raw === undefined) return undefined;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    log.warn(`${key}="${raw}" ist keine vollständige URL und wird ignoriert.`);
    log.warn(`  Erwartet wird z. B. https://example.com/logo.png - ein Dateipfad funktioniert nicht.`);
    return undefined;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    log.warn(`${key} muss mit http:// oder https:// beginnen - "${raw}" wird ignoriert.`);
    return undefined;
  }
  return raw;
}

/**
 * Liest einen Hex-Farbwert.
 *
 * Achtung, haeufige Stolperfalle: dotenv behandelt '#' als Kommentarzeichen.
 * Bei ACCENT_COLOR=#E80000 gilt alles ab dem '#' als Kommentar und der Wert
 * kommt als leerer String an. Deshalb wird dieser Fall hier erkannt und
 * gemeldet, statt still auf die Standardfarbe zurueckzufallen.
 */
function color(key, fallback) {
  const raw = process.env[key];

  if (raw !== undefined && raw.trim() === '') {
    log.warn(`${key} kommt leer an.`);
    log.warn(`  Farbwerte mit # gehören in Anführungszeichen:  ${key}="#RRGGBB"`);
    log.warn(`  Ohne Anführungszeichen wertet dotenv alles ab # als Kommentar.`);
    return fallback;
  }
  if (raw === undefined) return fallback;

  const hex = raw.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3}$/i.test(hex) && !/^[0-9a-f]{6}$/i.test(hex)) {
    log.warn(`${key}="${raw.trim()}" ist kein gültiger Hex-Farbwert - benutze Standardfarbe.`);
    return fallback;
  }

  // Kurzform #abc zu #aabbcc aufziehen.
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  return Number.parseInt(full, 16);
}

export const config = {
  // --- Discord ---
  token: str('DISCORD_TOKEN'),
  clientId: str('CLIENT_ID'),
  guildId: str('GUILD_ID'),
  statusChannelId: str('STATUS_CHANNEL_ID'),

  // --- DayZ Server ---
  host: str('SERVER_HOST'),
  gamePort: int('SERVER_PORT', 2302, { min: 1, max: 65535 }),
  queryPort: int('SERVER_QUERY_PORT', null, { min: 1, max: 65535 }), // null = gamedig ermittelt ihn automatisch
  serverNameOverride: str('SERVER_NAME'),

  // --- BattlEye RCon (optional, fuer Spielernamen und Spielzeit) ---
  rconEnabled: bool('RCON_ENABLED', false),
  rconHost: str('RCON_HOST') ?? str('SERVER_HOST'),
  rconPort: int('RCON_PORT', 2306, { min: 1, max: 65535 }),
  rconPassword: str('RCON_PASSWORD'),
  rconPollInterval: int('RCON_POLL_INTERVAL', 60, { min: 15, max: 600 }),

  // --- Spielzeit-Rangliste ---
  rankingChannelId: str('RANKING_CHANNEL_ID'),
  rankingDays: int('RANKING_DAYS', 30, { min: 1, max: 365 }),
  rankingUpdateInterval: int('RANKING_UPDATE_INTERVAL', 600, { min: 60, max: 86400 }),
  rankingPageSize: int('RANKING_PAGE_SIZE', 10, { min: 5, max: 25 }),

  // --- Verhalten ---
  pollInterval: int('POLL_INTERVAL', 60, { min: 15, max: 3600 }),
  updateInterval: int('UPDATE_INTERVAL', 60, { min: 15, max: 3600 }),
  chartHours: int('CHART_HOURS', 24, { min: 1, max: 720 }),
  retentionDays: int('RETENTION_DAYS', 30, { min: 1, max: 365 }),
  showPlayerList: bool('SHOW_PLAYER_LIST', true),

  // --- Optik ---
  accentColor: color('ACCENT_COLOR', 0x3ba55d),
  offlineColor: color('OFFLINE_COLOR', 0xed4245),
  mapImageUrl: imageUrl('MAP_IMAGE_URL'),
  timezone: str('TIMEZONE', 'Europe/Berlin'),

  // --- Speicher ---
  dbPath: str('DB_PATH', './data/status.db'),
};

const REQUIRED = [
  ['token', 'DISCORD_TOKEN', 'Bot-Token aus dem Discord Developer Portal'],
  ['clientId', 'CLIENT_ID', 'Application-ID deines Bots'],
  ['statusChannelId', 'STATUS_CHANNEL_ID', 'Channel-ID, in der die Status-Nachricht stehen soll'],
  ['host', 'SERVER_HOST', 'IP oder Hostname deines DayZ-Servers'],
];

export function validateConfig() {
  if (config.rconEnabled && !config.rconPassword) {
    log.error('RCON_ENABLED=true, aber RCON_PASSWORD fehlt.');
    log.error('  Das Passwort steht in der beserver_x64.cfg deines DayZ-Servers.');
    return false;
  }

  const missing = REQUIRED.filter(([key]) => !config[key]);
  if (missing.length > 0) {
    log.error('Die Konfiguration ist unvollstaendig. Es fehlen in deiner .env:');
    for (const [, env, hint] of missing) log.error(`  - ${env}  (${hint})`);
    log.error('Kopiere .env.example nach .env und fuelle die Werte aus.');
    return false;
  }
  return true;
}
