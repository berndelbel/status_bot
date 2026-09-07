// Diagnose der BattlEye-RCon-Verbindung.
// Sendet ausschliesslich lesende Befehle (players) - nichts Veraenderndes.
// Passwoerter werden nie ausgegeben.
import 'dotenv/config';
import { BattlEyeRcon, parsePlayers } from '../src/rcon.js';

const host = (process.env.RCON_HOST || process.env.SERVER_HOST || '').trim();
const port = Number.parseInt(process.env.RCON_PORT ?? '2306', 10);
const password = process.env.RCON_PASSWORD ?? '';

console.log('\n  --- RCon-Diagnose ---');
console.log(`  Ziel:     ${host || '(nicht gesetzt)'}:${port}`);
console.log(`  Passwort: ${password ? `gesetzt (${password.length} Zeichen)` : 'FEHLT'}`);

if (!host) {
  console.error('\n  RCON_HOST bzw. SERVER_HOST fehlt in der .env.\n');
  process.exit(1);
}
if (!password) {
  console.error('\n  RCON_PASSWORD fehlt in der .env.');
  console.error('  Es steht in der beserver_x64.cfg deines DayZ-Servers.\n');
  process.exit(1);
}

const rcon = new BattlEyeRcon({ host, port, password, timeout: 8000 });
rcon.on('message', (m) => console.log(`  [Servermeldung] ${m.trim()}`));

const started = Date.now();
try {
  await rcon.connect();
  console.log(`\n  ✓ Login erfolgreich (${Date.now() - started} ms)\n`);

  const raw = await rcon.command('players');
  const players = parsePlayers(raw);

  console.log(`  Spieler laut RCon: ${players.length}`);
  for (const p of players) {
    console.log(`    ${p.guid.slice(0, 12)}…  ${p.verified ? 'verifiziert' : 'ungeprüft '}  ${String(p.ping).padStart(4)} ms  ${p.name}`);
  }

  if (players.length === 0) {
    console.log('  (gerade niemand online - das ist kein Fehler)');
    console.log('\n  Rohantwort zur Kontrolle:');
    console.log(raw.split('\n').map((l) => `    |${l}`).join('\n'));
  }

  console.log('\n  ERGEBNIS: RCon funktioniert. Spielzeit-Erfassung ist moeglich.\n');
  rcon.close();
  process.exit(0);
} catch (err) {
  console.error(`\n  ✗ Fehlgeschlagen nach ${Date.now() - started} ms:`);
  console.error(`    ${err.message}\n`);

  if (/Keine Antwort/.test(err.message)) {
    console.error('  Moegliche Ursachen, in dieser Reihenfolge pruefen:');
    console.error('');
    console.error('  1. Firewall auf dem DayZ-Server laesst UDP ' + port + ' nicht durch.');
    console.error('     Auf dem DayZ-Server pruefen:  ufw status');
    console.error('     Freigeben nur fuer diese Maschine:');
    console.error('       ufw allow from <IP-DES-BOT-SERVERS> to any port ' + port + ' proto udp');
    console.error('');
    console.error('  2. BattlEye lauscht nur auf localhost.');
    console.error('     Auf dem DayZ-Server pruefen:  ss -lunp | grep ' + port);
    console.error('     Steht dort 127.0.0.1, ist der Port von aussen grundsaetzlich nicht');
    console.error('     erreichbar - dann muss der Bot auf derselben Maschine laufen.');
    console.error('');
    console.error('  3. Falscher Port. In der beserver_x64.cfg steht RConPort.');
  } else if (/abgelehnt/.test(err.message)) {
    console.error('  Der Server hat geantwortet, aber das Passwort nicht akzeptiert.');
    console.error('  RCON_PASSWORD muss exakt dem RConPassword aus der beserver_x64.cfg entsprechen.');
  }
  console.error('');
  rcon.close();
  process.exit(1);
}
