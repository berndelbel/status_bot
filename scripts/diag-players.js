// Diagnose: Was gibt der konfigurierte DayZ-Server beim Spieler-Query preis?
// Gibt bewusst NUR spielerbezogene Felder aus - keine Zugangsdaten.
import 'dotenv/config';
import { GameDig } from 'gamedig';

const host = process.env.SERVER_HOST?.trim();
const port = Number.parseInt(process.env.SERVER_PORT ?? '2302', 10);

if (!host) {
  console.error('SERVER_HOST fehlt in der .env.');
  process.exit(1);
}

console.log(`\n  Frage ${host}:${port} ab …\n`);

let state;
try {
  state = await GameDig.query({
    type: 'dayz',
    host,
    port,
    socketTimeout: 4000,
    attemptTimeout: 8000,
    maxRetries: 2,
    requestPlayers: true,
    requestRules: true,
  });
} catch (err) {
  console.error(`  Server nicht erreichbar: ${err?.message ?? err}\n`);
  process.exit(1);
}

console.log(`  Server:        ${state.name}`);
console.log(`  Karte:         ${state.map}`);
console.log(`  Spielerzahl:   ${state.numplayers} / ${state.maxplayers}`);
console.log(`  Warteschlange: ${state.raw?.queue ?? 0}`);

const players = state.players ?? [];
console.log(`\n  --- A2S_PLAYER Antwort ---`);
console.log(`  Eintraege im Spieler-Array: ${players.length}`);

if (players.length === 0) {
  console.log('\n  ERGEBNIS: Der Server liefert KEINE Spieler-Eintraege.');
  console.log('  Ein Ranking ueber die Serverabfrage ist damit nicht moeglich.');
} else {
  console.log('\n  Rohstruktur der ersten Eintraege:');
  for (const p of players.slice(0, 5)) {
    console.log(`    ${JSON.stringify(p)}`);
  }

  const mitNamen = players.filter(
    (p) => typeof p?.name === 'string' && p.name.trim() !== ''
  ).length;
  const mitZeit = players.filter((p) => Number.isFinite(p?.raw?.time ?? p?.time)).length;

  console.log(`\n  Eintraege mit ausgefuelltem Namen:      ${mitNamen} / ${players.length}`);
  console.log(`  Eintraege mit Verbindungsdauer (time): ${mitZeit} / ${players.length}`);

  console.log('\n  ERGEBNIS:');
  if (mitNamen > 0) {
    console.log('  Der Server gibt Spielernamen preis - ein Ranking ist moeglich.');
  } else if (mitZeit > 0) {
    console.log('  Der Server liefert Eintraege OHNE Namen, aber mit Verbindungsdauer.');
    console.log('  Damit laesst sich zaehlen, aber niemand einzeln zuordnen.');
  } else {
    console.log('  Eintraege vorhanden, aber ohne verwertbare Namen oder Zeiten.');
  }
}

// Verfuegbare Regeln koennen Hinweise auf die Serverkonfiguration geben.
const rules = state.raw?.rules ?? {};
const keys = Object.keys(rules);
console.log(`\n  Gemeldete Server-Regeln: ${keys.length > 0 ? keys.join(', ') : '(keine)'}`);
console.log('');
