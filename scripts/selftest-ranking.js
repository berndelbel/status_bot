// Selbsttest der Spielzeit-Rangliste mit simulierten Sitzungen.
// Braucht weder Discord noch RCon.
import './_selftest-env.js';

import { rmSync } from 'node:fs';
import { initDb, closeDb, upsertRconPlayer, startSession, touchSession, getPlaytimeRanking, closeStaleSessions, getOpenSessions } from '../src/db.js';
import { buildRankingMessage } from '../src/ranking.js';

for (const f of ['', '-wal', '-shm']) rmSync(`./data/selftest.db${f}`, { force: true });

const db = initDb();
const now = Math.floor(Date.now() / 1000);
const DAY = 86400;

const insertSession = db.prepare(
  'INSERT INTO rcon_sessions (guid, started, last_seen, ended) VALUES (?, ?, ?, ?)'
);

function guidOf(n) {
  return String(n).padStart(2, '0').repeat(16).slice(0, 32);
}

// --- 23 Spieler mit unterschiedlich vielen Sitzungen -----------------------
const namen = [
  'Bernd', 'Anna', 'Chris', 'Dora', 'Emil', 'Frida', 'Gustav', 'Heike',
  'Ingo', 'Jana', 'Klaus', 'Lena', 'Mert', 'Nina', 'Olaf', 'Petra',
  'Quirin', 'Rosa', 'Sven', 'Tina', 'Udo', 'Vera', 'Willi',
];

let sessionCount = 0;
namen.forEach((name, i) => {
  const guid = guidOf(i);
  upsertRconPlayer(guid, name, now);
  const sessions = 20 - i > 1 ? 20 - i : 2;
  for (let s = 0; s < sessions; s++) {
    const start = now - (s + 1) * DAY + s * 900;
    const dauer = 1800 + ((i * 137 + s * 61) % 9000); // 30 Min bis ~3 Std
    insertSession.run(guid, start, start + dauer, start + dauer);
    sessionCount++;
  }
});

console.log(`Simuliert: ${namen.length} Spieler, ${sessionCount} Sitzungen\n`);

// --- Randfall: Sitzung, die VOR dem Fenster begann -------------------------
// Nur der Teil innerhalb der letzten 30 Tage darf zaehlen.
const grenz = guidOf(90);
upsertRconPlayer(grenz, 'Grenzfall', now);
const start = now - 40 * DAY;
const ende = now - 29 * DAY; // laeuft 11 Tage, davon 1 Tag im Fenster
insertSession.run(grenz, start, ende, ende);

const since = now - 30 * DAY;
const nurGrenz = getPlaytimeRanking(since, now, { limit: 100 }).rows.find((r) => r.name === 'Grenzfall');
const erwartet = ende - since; // exakt der Anteil im Fenster
console.log('--- Randfall: Sitzung ragt aus dem Fenster heraus ---');
console.log(`  Sitzung gesamt:      ${((ende - start) / 3600).toFixed(1)} h`);
console.log(`  Davon im Fenster:    ${(erwartet / 3600).toFixed(1)} h`);
console.log(`  Rangliste rechnet:   ${(nurGrenz.seconds / 3600).toFixed(1)} h`);
console.log(`  ${nurGrenz.seconds === erwartet ? 'KORREKT' : 'FALSCH!'}\n`);

// --- Randfall: Name mit Backticks -----------------------------------------
const boese = guidOf(91);
upsertRconPlayer(boese, '```@everyone', now);
insertSession.run(boese, now - DAY, now - DAY + 600, now - DAY + 600);

// --- Randfall: offene Sitzung ---------------------------------------------
const offen = guidOf(92);
upsertRconPlayer(offen, 'NochOnline', now);
startSession(offen, now - 3600);
// Der Bot haelt laufende Sitzungen bei jeder Abfrage am Leben. Ohne diesen
// Sichtkontakt zaehlt die Sitzung bewusst 0 - es wird nie Zeit angerechnet,
// die nicht beobachtet wurde.
touchSession(offen, now);
console.log(`--- Offene Sitzungen: ${getOpenSessions().length} ---`);
const offenRow = getPlaytimeRanking(since, now, { limit: 100 }).rows.find((r) => r.name === 'NochOnline');
console.log(`  Laufende Sitzung zaehlt mit: ${(offenRow.seconds / 60).toFixed(0)} Min (erwartet ~60)\n`);

// --- Seiten durchblaettern -------------------------------------------------
for (const seite of [1, 2, 3, 99]) {
  const msg = buildRankingMessage(seite);
  const e = msg.embeds[0].toJSON();
  const zeilen = (e.description.match(/^ +\d+ /gm) ?? []).length;
  const knoepfe = msg.components[0]?.toJSON().components ?? [];
  console.log(`--- Seite ${seite} ---`);
  console.log(`  Fusszeile:  ${e.footer.text}`);
  console.log(`  Eintraege:  ${zeilen}`);
  console.log(
    `  Knoepfe:    ${knoepfe.map((b) => `${b.label}${b.disabled ? ' (aus)' : ''}`).join(' | ')}`
  );
}

console.log('\n--- Seite 1 im Wortlaut ---');
console.log(buildRankingMessage(1).embeds[0].toJSON().description);

// --- Aufraeumen beim Start -------------------------------------------------
console.log(`\n--- closeStaleSessions() ---`);
const geschlossen = closeStaleSessions();
console.log(`  Geschlossen: ${geschlossen}, danach offen: ${getOpenSessions().length}`);

closeDb();
for (const f of ['', '-wal', '-shm']) rmSync(`./data/selftest.db${f}`, { force: true });
console.log('\nSelbsttest Rangliste abgeschlossen.');
