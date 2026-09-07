# status_bot

Discord-Bot für DayZ-Server: zeigt eine **dauerhafte, sich selbst aktualisierende
Status-Nachricht** mit Live-Spielerzahl, gerendertem Verlaufsgraphen, Uptime-Statistik
und Ausfallhistorie.

Der Bot fragt den Server direkt per A2S-Protokoll ab – es wird **kein API-Key und kein
Drittanbieter-Dienst** benötigt. Der Verlauf wird in einer lokalen SQLite-Datenbank
aufgezeichnet und beginnt sich ab dem ersten Start zu füllen.

## Funktionen

- **Selbstaktualisierende Nachricht** – eine einzige Nachricht im Channel, die im
  eingestellten Takt neu geschrieben wird. Bei einem Online/Offline-Wechsel
  aktualisiert sie sofort, ohne auf das nächste Intervall zu warten.
- **Verlaufsgraph als Bild** – Spielerzahl über die Zeit, mit Farbverlauf,
  Peak-Markierung, Slot-Kapazität und rot hinterlegten Ausfällen.
- **Uptime-Tracking** – Verfügbarkeit über 24 h / 7 d / 30 d, Anzahl und Dauer der
  Ausfälle, „online seit"-Anzeige.
- **Live-Details** – Spielerzahl mit Auslastungsbalken, Warteschlange, Karte,
  Ingame-Zeit, Ping, First-Person/Private-Hive/Mod-Anzahl.
- **Bot-Präsenz** – der Bot zeigt „Schaut 24/60 Spieler" in der Mitgliederliste.
- **Bedienelemente** – Buttons für Aktualisieren, Verbindungsanleitung und
  Spielerliste, plus ein Dropdown für andere Zeiträume (1 h bis 30 d).

## Slash-Commands

| Befehl | Wirkung |
| --- | --- |
| `/status` | Momentaufnahme des Serverstatus (nur für dich sichtbar) |
| `/verlauf [zeitraum]` | Verlaufsgraph für 1 h, 6 h, 24 h, 7 d oder 30 d |
| `/uptime` | Verfügbarkeit und die letzten Ausfälle im Detail |
| `/spieler` | Aktuell verbundene Spieler, sofern der Server Namen preisgibt |
| `/statusnachricht` | Erstellt die dauerhafte Nachricht neu (nur Admins) |

## Einrichtung

### 1. Discord-Bot anlegen

1. Auf [discord.com/developers](https://discord.com/developers/applications) eine
   **New Application** erstellen.
2. Unter **Bot** den Token per *Reset Token* erzeugen und kopieren → `DISCORD_TOKEN`.
3. Unter **General Information** die *Application ID* kopieren → `CLIENT_ID`.
4. Unter **OAuth2 → URL Generator** die Scopes `bot` und `applications.commands`
   auswählen, dazu die Rechte **Send Messages**, **Embed Links**, **Attach Files**
   und **Read Message History**. Mit der erzeugten URL den Bot auf deinen Server holen.

Es werden **keine privilegierten Intents** benötigt – nichts zusätzlich aktivieren.

### 2. IDs herausfinden

In Discord unter *Einstellungen → Erweitert → Entwicklermodus* einschalten. Dann per
Rechtsklick auf den gewünschten Channel **ID kopieren** → `STATUS_CHANNEL_ID`, und per
Rechtsklick auf den Server-Namen → `GUILD_ID`.

### 3. Konfigurieren

```bash
cp .env.example .env
```

Anschließend `.env` ausfüllen. Pflichtfelder sind `DISCORD_TOKEN`, `CLIENT_ID`,
`STATUS_CHANNEL_ID` und `SERVER_HOST`. Alle weiteren Werte sind in der Datei
kommentiert.

> **Query-Port:** `SERVER_QUERY_PORT` am besten leer lassen. Er wird automatisch
> ermittelt (Spielport + 24714, bei Standard-Port also 27016). Nur eintragen, wenn
> dein Hoster ausdrücklich einen anderen Port nennt.

### 4. Starten

```bash
npm install
npm start
```

Beim ersten Start legt der Bot die Nachricht im Channel an und merkt sich deren ID in
der Datenbank – ein Neustart erzeugt also keine zweite Nachricht. Wurde die Nachricht
gelöscht, wird sie automatisch neu erstellt.

## Dauerbetrieb

Damit der Verlauf lückenlos bleibt, sollte der Bot durchlaufen. Unter Windows z. B. per
[PM2](https://pm2.keymetrics.io/):

```bash
npm install -g pm2
pm2 start npm --name status_bot -- start
pm2 save
pm2 startup
```

Zeiträume, in denen der Bot nicht lief, bleiben im Graphen als Lücke sichtbar und
werden **nicht** als Ausfall gewertet.

## Ohne Server testen

```bash
npm run selftest   # Befüllt eine Test-Datenbank und baut die komplette Nachricht
npm run preview    # Rendert nur den Graphen nach scripts/preview.png
```

Beide Skripte brauchen weder Discord-Token noch einen erreichbaren DayZ-Server.

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| [src/index.js](src/index.js) | Start, Discord-Client, Präsenz, sauberes Herunterfahren |
| [src/config.js](src/config.js) | `.env` einlesen, prüfen, Standardwerte |
| [src/query.js](src/query.js) | A2S-Abfrage des DayZ-Servers via gamedig |
| [src/monitor.js](src/monitor.js) | Poll-Schleife, Zustandswechsel, Überlappungsschutz |
| [src/db.js](src/db.js) | SQLite: Messungen, Ausfall-Ereignisse, Aufräumen |
| [src/stats.js](src/stats.js) | Uptime, Peaks, Buckets für den Graphen, Formatierung |
| [src/chart.js](src/chart.js) | Rendert den Verlaufsgraphen als PNG |
| [src/embed.js](src/embed.js) | Baut Embed, Buttons und Dropdown |
| [src/statusMessage.js](src/statusMessage.js) | Legt die dauerhafte Nachricht an und pflegt sie |
| [src/commands.js](src/commands.js) | Slash-Commands und Interaktionen |

## Hinweise

- **Spielernamen:** Die allermeisten DayZ-Server geben über die Serverabfrage keine
  Namen preis. Das ist die Standardeinstellung des Spiels und lässt sich nur
  serverseitig ändern. Spielerzahl, Verlauf und Uptime funktionieren davon unabhängig.
- **Warteschlange:** DayZ zählt wartende Spieler in der gemeldeten Gesamtzahl mit. Der
  Bot rechnet sie heraus und zeigt sie separat an.
- **Datenbank:** Die Datei unter `DB_PATH` enthält den gesamten Verlauf. Bei einem
  Umzug einfach mitkopieren.

## Technik

Node.js ≥ 22, ESM. Abhängigkeiten: `discord.js`, `gamedig`, `@napi-rs/canvas`,
`dotenv`. Für die Datenbank wird das in Node eingebaute `node:sqlite` verwendet –
es muss also nichts kompiliert werden.
