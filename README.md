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
| `/ranking [seite]` | Spielzeit-Rangliste, blätterbar |
| `/willkommen` | Vorschau der Willkommensnachricht (nur Admins) |
| `/statusnachricht [welche]` | Erstellt Status-Nachricht, Rangliste oder Rollen-Nachricht neu (nur Admins) |

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

## Auf einem Linux-Server betreiben

Getestete Grundlage: Debian 12 / Ubuntu 22.04+ auf einem Hetzner-Server.

### 1. Node.js 24 installieren

Die Paketquellen von Debian/Ubuntu liefern eine zu alte Version. Der Bot braucht
mindestens Node 22, weil er das eingebaute `node:sqlite` nutzt:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version          # muss v22 oder hoeher zeigen
```

### 2. Schriftarten installieren

**Wichtig und leicht zu uebersehen:** Der Graph wird serverseitig gerendert und
greift dafuer auf System-Schriften zu. Auf einem frisch aufgesetzten Server sind
keine installiert – der Graph kaeme dann ohne jede Beschriftung an.

```bash
sudo apt-get install -y fontconfig fonts-dejavu-core
fc-list | grep -i dejavu     # muss Treffer liefern
```

### 3. Projekt aufspielen

Ohne `node_modules` und ohne `.env` uebertragen, dann auf dem Server installieren:

```bash
# Auf dem Server
mkdir -p ~/status_bot

# Vom eigenen Rechner aus (PowerShell, im Projektordner)
scp -r src scripts deploy package.json package-lock.json README.md BENUTZER@SERVER-IP:~/status_bot/
scp .env BENUTZER@SERVER-IP:~/status_bot/
```

```bash
# Wieder auf dem Server
cd ~/status_bot
npm ci
```

`npm ci` installiert exakt die Versionen aus `package-lock.json`. Das Linux-Binary
fuer den Graphen ist vorgebaut – es wird kein Compiler benoetigt.

### 4. Testlauf

```bash
npm run selftest     # prueft Datenbank, Statistik, Graph und Embed
npm start            # startet den Bot; mit Strg+C wieder beenden
```

Laeuft alles, erscheint die Status-Nachricht im konfigurierten Channel.

### 5. Als Dienst einrichten (Dauerbetrieb)

Damit der Bot durchlaeuft, sich nach einem Absturz selbst neu startet und einen
Server-Neustart uebersteht, wird er als systemd-Dienst eingerichtet:

```bash
sudo bash deploy/install-service.sh
```

Das Skript ermittelt Projektpfad, Benutzer und Node-Pfad selbst und erzeugt daraus
die passende Unit. Vorher prueft es, ob `.env`, `node_modules`, eine ausreichende
Node-Version und Schriftarten vorhanden sind – fehlt etwas, bricht es mit einer
klaren Meldung ab, statt einen Dienst zu hinterlassen, der nicht startet.

Nur anschauen, ohne etwas zu installieren:

```bash
bash deploy/install-service.sh --dry-run
```

Unter einem anderen Benutzer laufen lassen:

```bash
sudo bash deploy/install-service.sh --user statusbot
```

Ohne Angabe laeuft der Dienst unter dem Benutzer, dem das Projektverzeichnis
gehoert.

### Bedienung des Dienstes

```bash
systemctl status status-bot        # laeuft er?
journalctl -u status-bot -f        # Logs live mitlesen
systemctl restart status-bot       # neu starten (z. B. nach .env-Aenderung)
systemctl stop status-bot          # anhalten
systemctl disable --now status-bot # abschalten und Autostart entfernen
```

Nach einer Aenderung an der `.env` ist ein `systemctl restart status-bot` noetig –
die Datei wird nur beim Start gelesen.

### Was der Dienst bei Ausfaellen tut

- **Bot stuerzt ab** – Neustart nach 10 Sekunden (`Restart=always`).
- **Server wird neu gestartet** – der Dienst startet automatisch mit hoch.
- **Dauerhafter Startfehler** – nach 5 Fehlversuchen in 5 Minuten gibt systemd auf,
  statt endlos zu rotieren. Ursache dann in `journalctl -u status-bot` nachlesen.
- **DayZ-Server nicht erreichbar** – das ist *kein* Fehlerfall. Der Bot laeuft
  weiter, zeichnet den Ausfall auf und stellt die Nachricht auf Offline um.

Zeitraeume, in denen der Bot nicht lief, bleiben im Graphen als Luecke sichtbar und
werden **nicht** als Ausfall gewertet.

## Spielzeit-Rangliste (optional)

Eine Rangliste nach Spielzeit braucht **BattlEye RCon**. Die normale Serverabfrage
gibt bei DayZ grundsätzlich keine Spielernamen preis – sie liefert zwar einen
Eintrag je Spieler, aber mit leerem Namensfeld. Das ist im Spiel so gebaut und
lässt sich nicht per `serverDZ.cfg` umstellen.

### Einrichtung

Zugangsdaten stehen in der `beserver_x64.cfg` deines DayZ-Servers:

```
RConPassword deinPasswort
RConPort 2306
```

Diese Werte in die `.env` eintragen und `RCON_ENABLED=true` setzen. Dann testen:

```bash
npm run diag:rcon
```

Das Skript meldet entweder Erfolg oder nennt die zu prüfenden Ursachen.

### Erreichbarkeit

Läuft der Bot auf einer **anderen** Maschine als der DayZ-Server, muss UDP auf dem
RCon-Port von dort aus erreichbar sein. Auf dem DayZ-Server prüfen:

```bash
ss -lunp | grep 2306        # lauscht BattlEye auf 0.0.0.0 oder nur auf 127.0.0.1?
```

Bei `0.0.0.0` gezielt für die Bot-Maschine freigeben – nicht für die ganze Welt:

```bash
ufw allow from <IP-DES-BOT-SERVERS> to any port 2306 proto udp
```

Bei `127.0.0.1` ist der Port von außen grundsätzlich nicht erreichbar; dann muss
der Bot auf derselben Maschine laufen. Das ist ohnehin die sicherste Variante,
weil dann weder ein Port offen sein noch ein Passwort übers Netz gehen muss.

### Wie gezählt wird

- Der Bot fragt die Spielerliste im Takt von `RCON_POLL_INTERVAL` ab und leitet
  daraus Sitzungen ab – bewusst per Abfrage statt über Join/Leave-Meldungen,
  damit sich der Zustand nach einem Verbindungsabriss selbst korrigiert.
- Gebucht wird auf die **GUID**, nicht auf den Namen. Ein Namenswechsel zählt
  weiter auf dasselbe Konto.
- Eine laufende Sitzung zählt nur bis zum **letzten Sichtkontakt**. Es wird nie
  Zeit angerechnet, die der Bot nicht beobachtet hat.
- Beim Start werden offene Sitzungen am letzten Sichtkontakt geschlossen – sonst
  würde die Zeit, in der der Bot aus war, als Spielzeit gelten.
- Sitzungen, die vor dem Wertungsfenster begannen, zählen nur mit ihrem Anteil
  **innerhalb** des Fensters.
- **IP-Adressen werden nicht gespeichert**, obwohl RCon sie mitliefert.

### Anzeige

Mit gesetzter `RANKING_CHANNEL_ID` pflegt der Bot eine dauerhafte Ranglisten-
Nachricht in diesem Channel. Sie zeigt immer die erste Seite; wer weiterblättert,
bekommt die Folgeseiten **privat** angezeigt. So springt die Seite nicht unter
anderen Lesern weg.

## Rollen zum Selbst-Aussuchen (optional)

Eine Nachricht in einem eigenen Channel, in der sich Mitglieder per Knopfdruck
selbst Rollen geben und wieder abnehmen.

**Knoepfe statt Emoji-Reaktionen:** Klassische Reaction Roles brauchen einen
zusaetzlichen Intent, greifen bei nicht zwischengespeicherten Nachrichten oft
nicht und geben dem Nutzer keine Rueckmeldung. Knoepfe brauchen keine
Sonderrechte, bestaetigen sofort und zeigen dem Klickenden privat, welche Rollen
er gerade hat.

### Einrichtung

```bash
cp config/roles.example.json config/roles.json
```

Rollen-IDs holst du in Discord per Rechtsklick auf die Rolle (*Servereinstellungen
-> Rollen*) mit **ID kopieren**, bei aktiviertem Entwicklermodus. Dann in die
`.env`:

```
ROLES_CHANNEL_ID=<Channel-ID>
```

Nach dem Neustart legt der Bot die Nachricht an. Aenderst du spaeter die
`roles.json`, erneuerst du sie mit `/statusnachricht welche:Rollen`.

### Zwei Voraussetzungen, an denen es fast immer haengt

1. Der Bot braucht das Recht **Rollen verwalten**.
2. Die **Bot-Rolle muss in der Rangfolge ueber allen Rollen stehen**, die er
   vergeben soll. Discord verweigert die Vergabe sonst kommentarlos.

Beides prueft der Bot beim Anlegen der Nachricht und meldet Probleme im Log
namentlich - du musst nicht raten, welche Rolle klemmt.

### Aufbau der roles.json

```json
{
  "title": "Wähle deine Rollen",
  "description": "Klick auf einen Knopf.",
  "groups": [
    {
      "name": "🔔 Benachrichtigungen",
      "roles": [
        { "id": "123...", "label": "Server-News", "emoji": "📢", "description": "Ankündigungen" }
      ]
    }
  ]
}
```

`emoji` und `description` sind optional. Eigene Server-Emojis im Format
`<:name:id>` funktionieren ebenfalls. Discord erlaubt hoechstens **25 Knoepfe**
pro Nachricht; darueber hinausgehende Rollen werden weggelassen und im Log
gemeldet.

## Willkommensnachricht (optional)

Begruesst neue Mitglieder in einem eigenen Channel - mit Avatar, Mitgliedsnummer
und dem Alter des Discord-Kontos.

### Wichtig: privilegierter Intent

Sobald `WELCOME_CHANNEL_ID` gesetzt ist, braucht der Bot den Intent
**SERVER MEMBERS**. Ohne ihn verweigert Discord die Anmeldung komplett - der Bot
startet dann gar nicht mehr.

1. [discord.com/developers](https://discord.com/developers/applications) oeffnen
2. Deine App -> **Bot** -> **Privileged Gateway Intents**
3. **SERVER MEMBERS INTENT** einschalten und speichern

Der Bot fordert den Intent nur an, wenn `WELCOME_CHANNEL_ID` gefuellt ist. Laesst
du die Zeile leer, bleibt alles wie bisher und es aendert sich nichts. Startet der
Bot mit der Meldung `disallowed intents` nicht mehr, sagt das Log genau, was zu
tun ist.

### Einrichtung

```bash
cp config/welcome.example.json config/welcome.json
```

In der `.env`:

```
WELCOME_CHANNEL_ID=<Channel-ID>
```

Mit `/willkommen` bekommst du eine Vorschau mit deinem eigenen Profil - ohne dass
jemand beitreten muss. Die Datei wird dabei jedes Mal frisch gelesen, du kannst
also Texte anpassen und sofort nachschauen.

### Platzhalter

| Platzhalter | Wird ersetzt durch |
| --- | --- |
| `{user}` | Erwaehnung des neuen Mitglieds (pingt) |
| `{username}` | Anzeigename ohne Erwaehnung |
| `{server}` | Name des Discord-Servers |
| `{count}` | aktuelle Mitgliederzahl |
| `{serverip}` | IP und Port des DayZ-Servers aus der `.env` |

Auf Channels verlinkst du mit `<#CHANNELID>`, auf Rollen mit `<@&ROLLENID>`.

### Schalter in der welcome.json

| Feld | Wirkung |
| --- | --- |
| `mentionUser` | Erwaehnt das Mitglied ueber dem Embed, sodass es einen Ping bekommt |
| `showAvatar` | Profilbild oben rechts |
| `showMemberCount` | "Mitglied Nr. 142" |
| `showAccountAge` | Wann das Discord-Konto erstellt wurde - hilft, frische Zweitkonten zu erkennen |
| `color` | `null` nimmt die `ACCENT_COLOR`, sonst z. B. `"#5865F2"` |
| `image` | Banner unten im Embed, nur vollstaendige `https`-URLs |

Fehlt die Datei oder ist sie fehlerhaft, benutzt der Bot Standardtexte statt
auszufallen.

## Ohne Server testen

```bash
npm run selftest          # Datenbank, Statistik, Graph und Status-Embed
npm run selftest:ranking  # Rangliste, Blättern und Berechnung der Spielzeiten
npm run selftest:rcon     # Parser der RCon-Spielerliste
npm run selftest:updater  # Aktualisierung der Ranglisten-Nachricht
npm run selftest:roles    # Rollen-Nachricht, Knöpfe und Discord-Limits
npm run selftest:welcome  # Willkommensnachricht, Platzhalter und Limits
npm run diag:sessions     # Zeigt erfasste Spielsitzungen im Detail
npm run preview           # Rendert nur den Graphen nach scripts/preview.png
npm run invite            # Baut die Einladungs-URL aus der CLIENT_ID
npm run diag:players      # Zeigt, was die Serverabfrage preisgibt
npm run diag:rcon         # Prüft die RCon-Verbindung
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
| [src/rcon.js](src/rcon.js) | BattlEye-RCon-Protokoll (UDP) |
| [src/playtime.js](src/playtime.js) | Erfasst Sitzungen je Spieler-GUID |
| [src/ranking.js](src/ranking.js) | Baut die Rangliste inkl. Blättern |
| [src/rankingMessage.js](src/rankingMessage.js) | Dauerhafte Ranglisten-Nachricht |
| [src/roles.js](src/roles.js) | Rollen-Konfiguration, Knöpfe, Rangfolge-Prüfung |
| [src/rolesMessage.js](src/rolesMessage.js) | Dauerhafte Rollen-Nachricht |
| [src/welcome.js](src/welcome.js) | Willkommensnachricht mit Platzhaltern |
| [src/channel.js](src/channel.js) | Channel auflösen und Rechte prüfen |
| [deploy/install-service.sh](deploy/install-service.sh) | Richtet den systemd-Dienst passend zur Umgebung ein |
| [deploy/status-bot.service](deploy/status-bot.service) | Unit-Vorlage für die manuelle Installation |

## Hinweise

- **Spielernamen:** DayZ-Server geben über die Serverabfrage keine Namen preis –
  der Eintrag existiert, das Namensfeld ist aber leer. Das ist im Spiel so gebaut
  und nicht per Konfiguration umstellbar. Für Namen und Spielzeit braucht es RCon
  (siehe oben). Spielerzahl, Verlauf und Uptime funktionieren davon unabhängig.
- **Farbwerte in der `.env`:** Unbedingt in Anführungszeichen setzen, also
  `ACCENT_COLOR="#E80000"`. Ohne sie wertet dotenv alles ab dem `#` als Kommentar
  und der Wert kommt leer an.
- **Warteschlange:** DayZ zählt wartende Spieler in der gemeldeten Gesamtzahl mit. Der
  Bot rechnet sie heraus und zeigt sie separat an.
- **Datenbank:** Die Datei unter `DB_PATH` enthält den gesamten Verlauf. Bei einem
  Umzug einfach mitkopieren.

## Technik

Node.js ≥ 22, ESM. Abhängigkeiten: `discord.js`, `gamedig`, `@napi-rs/canvas`,
`dotenv`. Für die Datenbank wird das in Node eingebaute `node:sqlite` verwendet –
es muss also nichts kompiliert werden.
