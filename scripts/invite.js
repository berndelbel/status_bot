// Baut die Einladungs-URL aus der CLIENT_ID in der .env.
// Gibt bewusst NUR die CLIENT_ID aus - der Token wird nie angezeigt.
import 'dotenv/config';

// Genau die Rechte, die der Bot braucht - nicht mehr.
const PERMISSIONS = {
  'Kanal ansehen': 1n << 10n,
  'Nachrichten senden': 1n << 11n,
  'Links einbetten': 1n << 14n,
  'Dateien anhängen': 1n << 15n,
  'Nachrichtenverlauf lesen': 1n << 16n,
};

const total = Object.values(PERMISSIONS).reduce((a, b) => a | b, 0n);
const clientId = process.env.CLIENT_ID?.trim();

if (!clientId) {
  console.error('\n  FEHLER: CLIENT_ID fehlt in der .env.');
  console.error('  Du findest sie im Developer Portal unter General Information.\n');
  process.exit(1);
}

if (!/^\d{17,20}$/.test(clientId)) {
  console.error(`\n  FEHLER: CLIENT_ID "${clientId}" sieht nicht wie eine Discord-ID aus.`);
  console.error('  Erwartet werden 17-20 Ziffern (nicht der Bot-Token!).\n');
  process.exit(1);
}

const url =
  'https://discord.com/oauth2/authorize' +
  `?client_id=${clientId}` +
  `&permissions=${total}` +
  '&scope=bot+applications.commands';

console.log('\n  Rechte in dieser Einladung:');
for (const name of Object.keys(PERMISSIONS)) console.log(`    - ${name}`);
console.log(`\n  Berechtigungswert: ${total}`);
console.log('\n  Diese URL im Browser öffnen:\n');
console.log(`  ${url}\n`);
console.log('  Danach den Ziel-Server auswählen und bestätigen.');
console.log('  Du brauchst dort das Recht "Server verwalten".\n');
