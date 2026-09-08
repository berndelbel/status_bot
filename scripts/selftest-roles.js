// Selbsttest der Rollen-Nachricht: Konfiguration, Knopf-Aufbau, Discord-Limits.
import './_roles-env.js';

import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { loadRolesConfig, buildRolesMessage, findRole } from '../src/roles.js';

mkdirSync('./data', { recursive: true });
const PFAD = './data/roles-test.json';
let fehler = 0;

function schreibe(inhalt) {
  writeFileSync(PFAD, JSON.stringify(inhalt, null, 2));
}

function pruefe(bezeichnung, bedingung, zusatz = '') {
  console.log(`  ${bedingung ? 'ok      ' : 'FEHLER  '} ${bezeichnung}${zusatz ? ' -> ' + zusatz : ''}`);
  if (!bedingung) fehler++;
}

const id = (n) => String(100000000000000000n + BigInt(n));

// --- Normalfall ------------------------------------------------------------
console.log('\n--- Normalfall: 2 Gruppen, 5 Rollen ---');
schreibe({
  title: 'Wähle deine Rollen',
  description: 'Klick drauf.',
  groups: [
    {
      name: '🔔 Benachrichtigungen',
      roles: [
        { id: id(1), label: 'Server-News', emoji: '📢', description: 'Ankündigungen' },
        { id: id(2), label: 'Events', emoji: '🎯' },
      ],
    },
    {
      name: '🎮 Spielstil',
      roles: [
        { id: id(3), label: 'PvP', emoji: '⚔️' },
        { id: id(4), label: 'Base Building', emoji: '🏠' },
        { id: id(5), label: 'Trader', emoji: '<:coin:123456789012345678>' },
      ],
    },
  ],
});

let cfg = loadRolesConfig({ force: true });
pruefe('Konfiguration geladen', cfg !== null);
pruefe('5 Rollen erkannt', cfg?.roles.length === 5, `${cfg?.roles.length}`);

let msg = buildRolesMessage();
const embed = msg.embeds[0].toJSON();
pruefe('2 Gruppenfelder im Embed', embed.fields.length === 2, `${embed.fields.length}`);
pruefe('Eine Knopfreihe (5 Knöpfe)', msg.components.length === 1, `${msg.components.length}`);

const knoepfe = msg.components[0].toJSON().components;
pruefe('5 Knöpfe', knoepfe.length === 5, `${knoepfe.length}`);
pruefe('Eigenes Emoji als ID geparst', knoepfe[4].emoji?.id === '123456789012345678');
pruefe('Unicode-Emoji als Name', knoepfe[0].emoji?.name === '📢');
pruefe('customId enthält die Rollen-ID', knoepfe[0].custom_id === `role:toggle:${id(1)}`);
pruefe('findRole findet den Eintrag', findRole(id(3))?.label === 'PvP');

console.log('\n  Embed-Feld "Benachrichtigungen":');
console.log(embed.fields[0].value.split('\n').map((z) => '    ' + z).join('\n'));

// --- Persoenliche Ansicht --------------------------------------------------
console.log('\n--- Persönliche Ansicht (Mitglied hat 2 Rollen) ---');
const eigene = new Set([id(1), id(4)]);
msg = buildRolesMessage(eigene);
const persEmbed = msg.embeds[0].toJSON();
const persKnoepfe = msg.components[0].toJSON().components;
pruefe('Hat-Rolle bekommt Haken', persEmbed.fields[0].value.includes('✅'));
pruefe('Nicht-Rolle bleibt neutral', persEmbed.fields[0].value.includes('▫️'));
pruefe('Knopf für eigene Rolle ist grün (Style 3)', persKnoepfe[0].style === 3, `${persKnoepfe[0].style}`);
pruefe('Knopf für fremde Rolle ist grau (Style 2)', persKnoepfe[1].style === 2, `${persKnoepfe[1].style}`);

// --- Ungueltige Eintraege --------------------------------------------------
console.log('\n--- Ungültige Einträge werden aussortiert ---');
schreibe({
  groups: [
    {
      name: 'Test',
      roles: [
        { id: 'keine-id', label: 'Kaputt' },
        { id: id(10), label: 'Gut' },
        { id: id(10), label: 'Doppelt' },
        { label: 'Ohne ID' },
      ],
    },
  ],
});
cfg = loadRolesConfig({ force: true });
pruefe('Nur die eine gültige Rolle bleibt', cfg?.roles.length === 1, `${cfg?.roles.length}`);
pruefe('Es ist die richtige', cfg?.roles[0].label === 'Gut');

// --- Discord-Limit: hoechstens 25 Knoepfe ----------------------------------
console.log('\n--- Limit von 25 Knöpfen ---');
schreibe({
  groups: [{ name: 'Viele', roles: Array.from({ length: 40 }, (_, i) => ({ id: id(200 + i), label: `R${i}` })) }],
});
cfg = loadRolesConfig({ force: true });
msg = buildRolesMessage();
const gesamtKnoepfe = msg.components.reduce((a, r) => a + r.toJSON().components.length, 0);
pruefe('Auf 25 Rollen gekappt', cfg?.roles.length === 25, `${cfg?.roles.length}`);
pruefe('Höchstens 5 Reihen', msg.components.length <= 5, `${msg.components.length}`);
pruefe('25 Knöpfe insgesamt', gesamtKnoepfe === 25, `${gesamtKnoepfe}`);
pruefe('Keine Reihe über 5 Knöpfen', msg.components.every((r) => r.toJSON().components.length <= 5));

// --- Emoji-Pruefung --------------------------------------------------------
// Discord lehnt die GESAMTE Nachricht ab, wenn ein einziger Knopf ein
// ungueltiges Emoji traegt (COMPONENT_INVALID_EMOJI). Deshalb hier aussortieren.
console.log('\n--- Emoji-Prüfung ---');
const emojiFaelle = [
  ['📢', true, 'Unicode-Emoji'],
  ['<:coin:123456789012345678>', true, 'eigenes Server-Emoji'],
  ['<a:wave:123456789012345678>', true, 'animiertes Server-Emoji'],
  ['1️⃣', true, 'Ziffern-Emoji'],
  ['⚔️', true, 'Emoji mit Variantenzeichen'],
  [':trader:', false, 'Doppelpunkt-Schreibweise'],
  ['Trader', false, 'einfacher Text'],
  ['💰 Trader', false, 'Emoji plus Text'],
  ['<:kaputt>', false, 'unvollständiges Server-Emoji'],
];

for (const [emoji, erwartet, bez] of emojiFaelle) {
  schreibe({ groups: [{ name: 'T', roles: [{ id: id(50), label: 'Rolle', emoji }] }] });
  const c = loadRolesConfig({ force: true });
  const angenommen = c?.roles[0].emoji !== null;
  pruefe(`${bez}: ${erwartet ? 'übernommen' : 'verworfen'}`, angenommen === erwartet, JSON.stringify(emoji));
}

// Trotz ungueltigem Emoji muss die Nachricht noch gebaut werden koennen.
schreibe({ groups: [{ name: 'T', roles: [{ id: id(50), label: 'Server-News', emoji: ':news:' }] }] });
loadRolesConfig({ force: true });
const notfall = buildRolesMessage();
const notfallKnopf = notfall?.components[0].toJSON().components[0];
pruefe('Nachricht baut trotz ungültigem Emoji', notfall !== null);
pruefe('Knopf ohne Emoji, aber mit Beschriftung', !notfallKnopf?.emoji && notfallKnopf?.label === 'Server-News');

// --- Kaputtes JSON ---------------------------------------------------------
console.log('\n--- Kaputte Datei ---');
writeFileSync(PFAD, '{ das ist kein json ');
pruefe('Fehlerhafte Datei führt zu null statt Absturz', loadRolesConfig({ force: true }) === null);

rmSync(PFAD, { force: true });
pruefe('Fehlende Datei führt zu null statt Absturz', loadRolesConfig({ force: true }) === null);

console.log(`\n${fehler === 0 ? 'Alle Rollen-Tests bestanden.' : `${fehler} Test(s) fehlgeschlagen!`}`);
process.exit(fehler === 0 ? 0 : 1);
