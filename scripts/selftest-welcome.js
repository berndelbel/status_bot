// Selbsttest der Willkommensnachricht - mit nachgebautem Mitglied, ohne Discord.
import './_welcome-env.js';

import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { loadWelcomeConfig, buildWelcomeMessage } from '../src/welcome.js';

mkdirSync('./data', { recursive: true });
const PFAD = './data/welcome-test.json';
let fehler = 0;

function pruefe(bezeichnung, bedingung, zusatz = '') {
  console.log(`  ${bedingung ? 'ok      ' : 'FEHLER  '} ${bezeichnung}${zusatz ? ' -> ' + zusatz : ''}`);
  if (!bedingung) fehler++;
}

// --- Nachgebautes Mitglied -------------------------------------------------
const member = {
  id: '424242424242424242',
  displayName: 'Bernd',
  toString: () => '<@424242424242424242>',
  user: {
    username: 'bernd',
    tag: 'bernd#0001',
    bot: false,
    createdTimestamp: Date.now() - 400 * 86400 * 1000,
    displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/2.png',
  },
  guild: { name: 'StashZ.gg', memberCount: 142 },
};

// --- Platzhalter -----------------------------------------------------------
console.log('\n--- Platzhalter ---');
writeFileSync(
  PFAD,
  JSON.stringify({
    title: 'Willkommen auf {server}!',
    description: 'Hallo {user} alias {username}! Du bist Nummer {count}.',
    fields: [{ name: 'Server', value: '{serverip}' }],
    footer: 'Bis gleich, {username}',
    mentionUser: true,
  })
);
loadWelcomeConfig({ force: true });
let msg = buildWelcomeMessage(member);
let e = msg.embeds[0].toJSON();

pruefe('{server} ersetzt', e.title === 'Willkommen auf StashZ.gg!', e.title);
pruefe('{user} wird zur Erwähnung', e.description.includes('<@424242424242424242>'));
pruefe('{username} ersetzt', e.description.includes('Bernd'));
pruefe('{count} ersetzt', e.description.includes('142'));
pruefe('{serverip} ersetzt', e.fields[0].value.includes('dayz.example.net:2302'), e.fields[0].value);
pruefe('{username} auch in der Fußzeile', e.footer.text === 'Bis gleich, Bernd', e.footer.text);

console.log('\n  Aufgebautes Embed:');
console.log('    Titel:        ' + e.title);
console.log('    Beschreibung: ' + e.description.replace(/\n/g, ' / '));
for (const f of e.fields) console.log(`    Feld "${f.name}": ${f.value.replace(/\n/g, ' ')}`);
console.log('    Fußzeile:     ' + e.footer.text);
console.log('    Thumbnail:    ' + (e.thumbnail?.url ?? 'keins'));

// --- Erwaehnung ------------------------------------------------------------
console.log('\n--- Erwähnung ---');
pruefe('content enthält die Erwähnung', msg.content === '<@424242424242424242>');
pruefe(
  'allowedMentions erlaubt genau diesen Nutzer',
  msg.allowedMentions?.users?.length === 1 && msg.allowedMentions.users[0] === member.id
);

writeFileSync(PFAD, JSON.stringify({ mentionUser: false, description: 'Hi' }));
loadWelcomeConfig({ force: true });
msg = buildWelcomeMessage(member);
pruefe('ohne mentionUser kein content', msg.content === undefined);

// --- Zusatzzeile -----------------------------------------------------------
console.log('\n--- Mitgliedszahl und Kontoalter ---');
writeFileSync(PFAD, JSON.stringify({ showMemberCount: true, showAccountAge: true, description: 'Hi' }));
loadWelcomeConfig({ force: true });
e = buildWelcomeMessage(member).embeds[0].toJSON();
const zusatz = e.fields.at(-1).value;
pruefe('Mitgliedsnummer steht drin', zusatz.includes('142'), zusatz);
pruefe('Kontoalter als Zeitstempel', /<t:\d+:R>/.test(zusatz));

writeFileSync(PFAD, JSON.stringify({ showMemberCount: false, showAccountAge: false, description: 'Hi' }));
loadWelcomeConfig({ force: true });
e = buildWelcomeMessage(member).embeds[0].toJSON();
pruefe('abschaltbar', (e.fields ?? []).length === 0, `${(e.fields ?? []).length} Felder`);

// --- Randfaelle ------------------------------------------------------------
console.log('\n--- Randfälle ---');
writeFileSync(
  PFAD,
  JSON.stringify({
    title: 'T'.repeat(400),
    description: 'D'.repeat(5000),
    image: 'nicht-erreichbar/bild.png',
    fields: [{ name: 'X', value: 'V'.repeat(2000) }],
  })
);
loadWelcomeConfig({ force: true });
e = buildWelcomeMessage(member).embeds[0].toJSON();
pruefe('Titel auf 256 gekappt', e.title.length === 256, `${e.title.length}`);
pruefe('Beschreibung auf 4096 gekappt', e.description.length === 4096, `${e.description.length}`);
pruefe('Feldwert auf 1024 gekappt', e.fields[0].value.length === 1024, `${e.fields[0].value.length}`);
pruefe('ungültige Bild-URL weggelassen', e.image === undefined);

writeFileSync(PFAD, '{ kaputt ');
const fallback = loadWelcomeConfig({ force: true });
pruefe('kaputte Datei -> Standardtexte statt Absturz', fallback.title.includes('{server}'));

rmSync(PFAD, { force: true });
const ohneDatei = loadWelcomeConfig({ force: true });
pruefe('fehlende Datei -> Standardtexte', ohneDatei.title.includes('{server}'));
pruefe('baut auch mit Standardtexten', buildWelcomeMessage(member).embeds.length === 1);

console.log(`\n${fehler === 0 ? 'Alle Willkommens-Tests bestanden.' : `${fehler} Test(s) fehlgeschlagen!`}`);
process.exit(fehler === 0 ? 0 : 1);
