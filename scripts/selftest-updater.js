// Prueft, ob die Ranglisten-Nachricht bei wiederholten Aufrufen wirklich
// neu geschrieben wird - mit nachgebautem Discord-Client, ohne Netzwerk.
import './_updater-env.js';

import { rmSync } from 'node:fs';
import { ChannelType } from 'discord.js';
import { initDb, closeDb, upsertRconPlayer, startSession, touchSession } from '../src/db.js';
import { updateRankingMessage } from '../src/rankingMessage.js';

for (const f of ['', '-wal', '-shm']) rmSync('./data/selftest.db' + f, { force: true });
initDb();

// --- Nachgebauter Discord-Client ------------------------------------------
const edits = [];
let sendCount = 0;

const fakeMessage = {
  id: '111111111111111111',
  url: 'https://discord.com/channels/1/2/3',
  async edit(payload) {
    edits.push(payload.embeds[0].toJSON().description);
    return fakeMessage;
  },
};

const fakeChannel = {
  id: '999999999999999999',
  name: 'rangliste',
  type: ChannelType.GuildText,
  guild: { members: { me: {}, fetchMe: async () => ({}) } },
  permissionsFor: () => ({ missing: () => [] }),
  messages: { fetch: async () => fakeMessage },
  async send(payload) {
    sendCount++;
    edits.push(payload.embeds[0].toJSON().description);
    return fakeMessage;
  },
};

const fakeClient = { channels: { fetch: async () => fakeChannel } };

// --- Sitzung anlegen und wachsen lassen -----------------------------------
const now = Math.floor(Date.now() / 1000);
const guid = 'a'.repeat(32);
upsertRconPlayer(guid, 'Imanohand', now);
// Sitzung liegt komplett in der Vergangenheit - Zeitstempel in der Zukunft
// wuerden von der Abfrage korrekt auf "jetzt" gekappt.
startSession(guid, now - 900);
touchSession(guid, now - 660); // 4 Minuten erfasst

function zeitAus(text) {
  return text?.match(/(\d+ (?:s|Min)|\d+,\d+ h)/)?.[1] ?? '(keine)';
}

console.log('\n--- Aufruf 1 (wie beim Bot-Start) ---');
await updateRankingMessage(fakeClient);
console.log(`  gesendet: ${sendCount}, geschrieben: ${edits.length}`);
console.log(`  Zeit in der Nachricht: ${zeitAus(edits.at(-1))}`);

console.log('\n--- Aufruf 2 ohne Datenaenderung (wie ein Intervall-Tick) ---');
const vorher = edits.length;
await updateRankingMessage(fakeClient);
console.log(`  zusaetzliche Schreibvorgaenge: ${edits.length - vorher} (muss > 0 sein)`);
console.log(`  Zeit in der Nachricht: ${zeitAus(edits.at(-1))}`);

console.log('\n--- Aufruf 3 nachdem die Sitzung um 5 Minuten gewachsen ist ---');
touchSession(guid, now - 360); // insgesamt 9 Minuten
await updateRankingMessage(fakeClient);
console.log(`  Zeit in der Nachricht: ${zeitAus(edits.at(-1))}`);

// --- Bewertung -------------------------------------------------------------
const ersteZeit = zeitAus(edits[0]);
const letzteZeit = zeitAus(edits.at(-1));
const geschrieben = edits.length >= 3;
const gewachsen = ersteZeit !== letzteZeit;

console.log('\n--- Ergebnis ---');
console.log(`  Nachricht wird bei jedem Aufruf geschrieben: ${geschrieben ? 'ja' : 'NEIN'}`);
console.log(`  Inhalt folgt den Daten (${ersteZeit} -> ${letzteZeit}): ${gewachsen ? 'ja' : 'NEIN'}`);
console.log(`  Nur EINE Nachricht erstellt (kein Doppelposten): ${sendCount === 1 ? 'ja' : 'NEIN (' + sendCount + ')'}`);

const ok = geschrieben && gewachsen && sendCount === 1;
console.log(`\n  ${ok ? 'BESTANDEN - der Updater funktioniert.' : 'FEHLGESCHLAGEN'}`);

closeDb();
for (const f of ['', '-wal', '-shm']) rmSync('./data/selftest.db' + f, { force: true });
process.exit(ok ? 0 : 1);
