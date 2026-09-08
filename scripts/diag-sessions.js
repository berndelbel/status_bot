// Zeigt die erfassten Spielsitzungen im Detail.
// Damit laesst sich pruefen, ob die Spielzeit plausibel gezaehlt wird.
import 'dotenv/config';
import { initDb, closeDb } from '../src/db.js';

const db = initDb();
const now = Math.floor(Date.now() / 1000);

const uhr = (ts) =>
  new Date(ts * 1000).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const dauer = (s) => {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} Min ${s % 60} s`;
  return `${Math.floor(s / 3600)} Std ${Math.floor((s % 3600) / 60)} Min`;
};

// --- Laufende Sitzungen ----------------------------------------------------
const offen = db
  .prepare(
    `SELECT s.guid, p.name, s.started, s.last_seen
     FROM rcon_sessions s LEFT JOIN rcon_players p ON p.guid = s.guid
     WHERE s.ended IS NULL ORDER BY s.started ASC`
  )
  .all();

console.log(`\n=== Laufende Sitzungen: ${offen.length} ===`);
for (const s of offen) {
  console.log(
    `  ${(s.name ?? s.guid.slice(0, 8)).padEnd(18)} seit ${uhr(s.started)}` +
      `  gezaehlt: ${dauer(s.last_seen - s.started).padEnd(16)}` +
      `  letzter Kontakt vor ${dauer(now - s.last_seen)}`
  );
}
if (offen.length === 0) {
  console.log('  (keine - entweder ist niemand online oder RCon ist nicht verbunden)');
}

// --- Alle Sitzungen je Spieler --------------------------------------------
const spieler = db
  .prepare(
    `SELECT p.guid, p.name, COUNT(*) AS anzahl,
            SUM(COALESCE(s.ended, s.last_seen) - s.started) AS summe
     FROM rcon_players p JOIN rcon_sessions s ON s.guid = p.guid
     GROUP BY p.guid ORDER BY summe DESC`
  )
  .all();

console.log(`\n=== Sitzungen je Spieler ===`);
for (const p of spieler) {
  console.log(`\n  ${p.name}  -  ${p.anzahl} Sitzungen, zusammen ${dauer(p.summe)}`);
  const einzeln = db
    .prepare(
      `SELECT started, last_seen, ended FROM rcon_sessions
       WHERE guid = ? ORDER BY started DESC LIMIT 12`
    )
    .all(p.guid);
  for (const s of einzeln) {
    const bis = s.ended ?? s.last_seen;
    const laeuft = s.ended === null ? ' (laeuft)' : '';
    console.log(`      ${uhr(s.started)} → ${uhr(bis)}   ${dauer(bis - s.started).padEnd(16)}${laeuft}`);
  }
}

// --- Bewertung -------------------------------------------------------------
const nullen = db
  .prepare('SELECT COUNT(*) AS n FROM rcon_sessions WHERE COALESCE(ended, last_seen) - started < 5')
  .get().n;
const gesamt = db.prepare('SELECT COUNT(*) AS n FROM rcon_sessions').get().n;

console.log(`\n=== Bewertung ===`);
console.log(`  Sitzungen gesamt:        ${gesamt}`);
console.log(`  davon unter 5 Sekunden:  ${nullen}`);

if (nullen > 0) {
  console.log('');
  console.log('  Sehr kurze Sitzungen entstehen bei jedem Neustart des Bots: offene');
  console.log('  Sitzungen werden dabei am letzten Sichtkontakt geschlossen. Wenn kurz');
  console.log('  danach neu gestartet wird, bleibt fast keine Zeit uebrig.');
  console.log('  Solange die Zahl klein bleibt und nicht weiter waechst, ist alles in');
  console.log('  Ordnung. Waechst sie im Minutentakt, startet der Dienst staendig neu:');
  console.log('    systemctl status status-bot');
  console.log('    journalctl -u status-bot -n 50 --no-pager');
}

if (offen.length > 0) {
  const alt = offen.filter((s) => now - s.last_seen > 180);
  if (alt.length > 0) {
    console.log('');
    console.log(`  ACHTUNG: ${alt.length} laufende Sitzung(en) ohne Kontakt seit ueber 3 Minuten.`);
    console.log('  Dann laeuft die RCon-Abfrage nicht mehr - Logs pruefen.');
  }
}

console.log('');
closeDb();
