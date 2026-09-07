// Selbsttest ohne Discord und ohne echten Server:
// befuellt eine temporaere Datenbank mit simulierten Messungen und baut daraus
// die komplette Status-Nachricht. Prueft Datenbank, Statistik, Graph und Embed.
import './_selftest-env.js';

import { writeFileSync, rmSync } from 'node:fs';
import { initDb, closeDb } from '../src/db.js';
import { collectStats, buildSeries, sparkline, formatDuration, formatPercent } from '../src/stats.js';
import { buildStatusMessage, buildRangeMessage } from '../src/embed.js';

rmSync('./data/selftest.db', { force: true });
rmSync('./data/selftest.db-wal', { force: true });
rmSync('./data/selftest.db-shm', { force: true });

const db = initDb();
const now = Math.floor(Date.now() / 1000);
const STEP = 60;
const HOURS = 72;

// --- Simulierte Historie: Tagesrhythmus + zwei Ausfaelle -------------------
const insert = db.prepare(
  'INSERT OR REPLACE INTO samples (ts, online, players, max_players, queue, ping) VALUES (?,?,?,?,?,?)'
);
const addEvent = db.prepare('INSERT INTO events (ts, online) VALUES (?, ?)');

let prevOnline = null;
let inserted = 0;
for (let t = now - HOURS * 3600; t <= now; t += STEP) {
  const hour = new Date(t * 1000).getHours();
  // Zwei Ausfaelle: vor 30 h (45 min) und vor 5 h (12 min)
  const down =
    (t > now - 30 * 3600 && t < now - 30 * 3600 + 45 * 60) ||
    (t > now - 5 * 3600 && t < now - 5 * 3600 + 12 * 60);

  const base = 24 + 20 * Math.sin(((hour - 4) / 24) * Math.PI * 2);
  const players = Math.max(0, Math.round(base + (Math.random() - 0.5) * 6));

  insert.run(t, down ? 0 : 1, down ? 0 : players, 60, 0, down ? null : 30 + Math.round(Math.random() * 25));
  inserted++;

  const online = down ? 0 : 1;
  if (prevOnline !== online) {
    addEvent.run(t, online);
    prevOnline = online;
  }
}

console.log(`Simulierte Messungen: ${inserted} über ${HOURS} Stunden\n`);

// --- Statistik prüfen ------------------------------------------------------
const stats = collectStats(24);
console.log('--- Statistik (24 h) ---');
console.log(`Messungen:     ${stats.samples}`);
console.log(`Uptime:        ${formatPercent(stats.uptimeRatio)}`);
console.log(`Peak:          ${stats.peak}`);
console.log(`Durchschnitt:  ${stats.avg}`);
console.log(`Ausfälle:      ${stats.outageCount} (${formatDuration(stats.downtimeSeconds)} gesamt)`);
console.log(`Aktuell:       ${stats.streak?.online ? 'online' : 'offline'} seit ${new Date(stats.streak.since * 1000).toLocaleString('de-DE')}`);

const series = buildSeries(24, 96);
console.log(`\nSparkline:     ${sparkline(series)}`);

const gaps = series.filter((s) => s.empty).length;
const offline = series.filter((s) => s.offline).length;
console.log(`Buckets:       ${series.length} (${offline} Ausfall, ${gaps} ohne Daten)\n`);

// --- Embed bauen -----------------------------------------------------------
const state = {
  online: true,
  name: 'Survivor Heaven | Chernarus | Hardcore',
  map: 'chernarusplus',
  players: 41,
  maxPlayers: 60,
  queue: 3,
  ping: 34,
  playerList: [],
  connect: '127.0.0.1:2302',
  password: false,
  ingameTime: '19:42',
  firstPerson: true,
  privateHive: true,
  official: false,
  version: '1.28',
  mods: ['Community Framework', 'Code Lock', 'Trader'],
  queriedAt: Date.now(),
  durationMs: 42,
};

const msg = buildStatusMessage(state);
const embed = msg.embeds[0].toJSON();

console.log('--- Embed (online) ---');
console.log(`Titel:  ${embed.title}`);
console.log(`Farbe:  #${embed.color.toString(16).padStart(6, '0')}`);
console.log(`\n${embed.description}\n`);
for (const f of embed.fields) {
  console.log(`[${f.inline ? 'inline' : ' block'}] ${f.name}\n          ${f.value.replace(/\n/g, '\n          ')}`);
}
console.log(`\nFooter: ${embed.footer.text}`);
console.log(`Bild:   ${embed.image.url}`);
console.log(`Buttons/Menüs: ${msg.components.length} Reihen, ${msg.components.map((r) => r.toJSON().components.length).join(' + ')} Elemente`);

writeFileSync('scripts/preview-status.png', msg.files[0].attachment);
console.log('Graph gespeichert: scripts/preview-status.png');

// --- Offline-Variante ------------------------------------------------------
const offlineMsg = buildStatusMessage({
  online: false,
  error: 'Timeout beim Abfragen von 127.0.0.1:27016',
  players: 0,
  maxPlayers: 0,
  queue: 0,
  ping: null,
});
const offEmbed = offlineMsg.embeds[0].toJSON();
console.log('\n--- Embed (offline) ---');
console.log(`Titel:  ${offEmbed.title}`);
console.log(`\n${offEmbed.description}\n`);

// --- Zeitraum-Ansicht ------------------------------------------------------
const rangeMsg = buildRangeMessage('7d', state);
writeFileSync('scripts/preview-7d.png', rangeMsg.files[0].attachment);
console.log(`--- /verlauf 7d ---`);
console.log(`Titel:  ${rangeMsg.embeds[0].toJSON().title}`);
console.log(`Footer: ${rangeMsg.embeds[0].toJSON().footer.text}`);
console.log('Graph gespeichert: scripts/preview-7d.png');

closeDb();
rmSync('./data/selftest.db', { force: true });
rmSync('./data/selftest.db-wal', { force: true });
rmSync('./data/selftest.db-shm', { force: true });
console.log('\nSelbsttest abgeschlossen.');
