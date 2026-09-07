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

function color(key, fallback) {
  const raw = str(key);
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw.replace(/^#/, ''), 16);
  return Number.isNaN(n) ? fallback : n;
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

  // --- Verhalten ---
  pollInterval: int('POLL_INTERVAL', 60, { min: 15, max: 3600 }),
  updateInterval: int('UPDATE_INTERVAL', 60, { min: 15, max: 3600 }),
  chartHours: int('CHART_HOURS', 24, { min: 1, max: 720 }),
  retentionDays: int('RETENTION_DAYS', 30, { min: 1, max: 365 }),
  showPlayerList: bool('SHOW_PLAYER_LIST', true),

  // --- Optik ---
  accentColor: color('ACCENT_COLOR', 0x3ba55d),
  offlineColor: color('OFFLINE_COLOR', 0xed4245),
  mapImageUrl: str('MAP_IMAGE_URL'),
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
  const missing = REQUIRED.filter(([key]) => !config[key]);
  if (missing.length > 0) {
    log.error('Die Konfiguration ist unvollstaendig. Es fehlen in deiner .env:');
    for (const [, env, hint] of missing) log.error(`  - ${env}  (${hint})`);
    log.error('Kopiere .env.example nach .env und fuelle die Werte aus.');
    return false;
  }
  return true;
}
