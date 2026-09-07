// Prueft den Parser der RCon-Spielerliste gegen echte Server-Ausgaben.
// Der Datensatz "Echter Server" stammt 1:1 von einem laufenden DayZ-Server -
// IP-Adressen sind dabei durch Platzhalter ersetzt, sie werden ohnehin verworfen.
import { parsePlayers } from '../src/rcon.js';

let fehler = 0;

function pruefe(bezeichnung, text, erwartet) {
  const ist = parsePlayers(text);
  const okAnzahl = ist.length === erwartet.length;
  const okInhalt =
    okAnzahl &&
    erwartet.every((e, i) => ist[i].guid === e.guid && ist[i].name === e.name && ist[i].verified === e.verified);

  console.log(`\n--- ${bezeichnung} ---`);
  console.log(`  erwartet: ${erwartet.length} Spieler, erkannt: ${ist.length}`);
  for (const p of ist) {
    console.log(`    ${p.guid.slice(0, 10)}…  ${p.verified ? 'geprüft  ' : 'ungeprüft'}  ${String(p.ping).padStart(3)} ms  ${JSON.stringify(p.name)}`);
  }
  if (okAnzahl && okInhalt) {
    console.log('  BESTANDEN');
  } else {
    console.log('  FEHLGESCHLAGEN');
    console.log(`    erwartet: ${JSON.stringify(erwartet)}`);
    fehler++;
  }
}

// --- Echter Server: alle Spieler ungeprueft "(?)", Name mit Leerzeichen ----
pruefe(
  'Echter Server (Status "(?)", Name mit Leerzeichen und Pipe)',
  `Players on server:
[#] [IP Address]:[Port] [Ping] [GUID] [Name]
--------------------------------------------------
2   203.0.113.12:63455     64   0841e4d922072de050edfb70174e0e7b(?)  Survivor
1   203.0.113.170:53863    71   80a6c02b21b68f54acf260fa366880ee(?)  PD | Till
0   198.51.100.146:25972   99   1b90e1e0ec1ce3fa1793150a11dcb78e(?)  Imanohand
(3 players in total)`,
  [
    { guid: '0841e4d922072de050edfb70174e0e7b', name: 'Survivor', verified: false },
    { guid: '80a6c02b21b68f54acf260fa366880ee', name: 'PD | Till', verified: false },
    { guid: '1b90e1e0ec1ce3fa1793150a11dcb78e', name: 'Imanohand', verified: false },
  ]
);

// --- Geprueft "(OK)" -------------------------------------------------------
pruefe(
  'Geprüfte Spieler "(OK)"',
  `Players on server:
[#] [IP Address]:[Port] [Ping] [GUID] [Name]
--------------------------------------------------
0   203.0.113.5:2304   35   aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa(OK) Bernd
(1 players in total)`,
  [{ guid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'Bernd', verified: true }]
);

// --- Leere Liste -----------------------------------------------------------
pruefe(
  'Niemand online',
  `Players on server:
[#] [IP Address]:[Port] [Ping] [GUID] [Name]
--------------------------------------------------
(0 players in total)`,
  []
);

// --- Randfaelle ------------------------------------------------------------
pruefe(
  'Lobby-Zusatz, negativer Ping, fehlende GUID',
  `Players on server:
[#] [IP Address]:[Port] [Ping] [GUID] [Name]
--------------------------------------------------
0   203.0.113.5:2304   -1   bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb(?)  NeuerSpieler (Lobby)
1   203.0.113.6:2304   50   -(?)  OhneGuid
(2 players in total)`,
  [
    { guid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', name: 'NeuerSpieler', verified: false },
    { guid: '-', name: 'OhneGuid', verified: false },
  ]
);

// --- Kopfzeilen duerfen nie als Spieler durchgehen -------------------------
const kopf = parsePlayers(`Players on server:
[#] [IP Address]:[Port] [Ping] [GUID] [Name]
--------------------------------------------------
(0 players in total)`);
console.log(`\n--- Kopfzeilen werden nicht als Spieler gelesen ---`);
console.log(`  erkannt: ${kopf.length} (muss 0 sein) -> ${kopf.length === 0 ? 'BESTANDEN' : 'FEHLGESCHLAGEN'}`);
if (kopf.length !== 0) fehler++;

console.log(`\n${fehler === 0 ? 'Alle Parser-Tests bestanden.' : `${fehler} Test(s) fehlgeschlagen!`}`);
process.exit(fehler === 0 ? 0 : 1);
