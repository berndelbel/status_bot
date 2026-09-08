import { Client, GatewayIntentBits, ActivityType, Events } from 'discord.js';
import { config, validateConfig } from './config.js';
import { log } from './logger.js';
import { initDb, closeDb } from './db.js';
import { monitor, startMonitor, stopMonitor, getLastState } from './monitor.js';
import { startStatusUpdater, stopStatusUpdater, updateStatusMessage } from './statusMessage.js';
import { startRankingUpdater, stopRankingUpdater } from './rankingMessage.js';
import { startPlaytimeTracking, stopPlaytimeTracking } from './playtime.js';
import { registerCommands, handleInteraction } from './commands.js';
import { registerWelcomeHandler, loadWelcomeConfig } from './welcome.js';

if (!validateConfig()) process.exit(1);

initDb();

// Der Intent fuer Beitritte ist privilegiert und muss im Developer Portal
// freigeschaltet sein. Er wird deshalb nur angefordert, wenn die
// Willkommensnachricht auch wirklich konfiguriert ist - sonst koennte sich der
// Bot ueberhaupt nicht mehr anmelden.
const intents = [GatewayIntentBits.Guilds];
if (config.welcomeChannelId) {
  intents.push(GatewayIntentBits.GuildMembers);
  log.info('Willkommensnachricht aktiv - fordere den Intent "Server Members" an.');
}

const client = new Client({
  intents,
  // Keine Erwähnungen aus Embed-Inhalten auslösen.
  allowedMentions: { parse: [] },
});

client.once(Events.ClientReady, async (c) => {
  log.ok(`Angemeldet als ${c.user.tag}`);
  await registerCommands();
  startMonitor();
  startStatusUpdater(client);
  startPlaytimeTracking();
  startRankingUpdater(client);
});

client.on(Events.InteractionCreate, (interaction) => handleInteraction(interaction, client));

registerWelcomeHandler(client);

// Bot-Status in der Mitgliederliste mitführen: "Spielt 24/60 Spieler".
monitor.on('sample', (state, { changed }) => {
  if (!client.isReady()) return;

  if (state.online) {
    client.user.setPresence({
      status: 'online',
      activities: [
        {
          name: `${state.players}/${state.maxPlayers} Spieler`,
          type: ActivityType.Watching,
        },
      ],
    });
  } else {
    client.user.setPresence({
      status: 'dnd',
      activities: [{ name: 'Server offline', type: ActivityType.Watching }],
    });
  }

  // Bei einem Zustandswechsel nicht auf das nächste Intervall warten.
  if (changed) void updateStatusMessage(client);
});

client.on(Events.Error, (err) => log.error('Discord-Client:', err?.message ?? err));
client.rest.on('rateLimited', (info) =>
  log.warn(`Rate-Limit: ${info.route} - warte ${Math.round(info.timeToReset / 1000)} s`)
);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} empfangen - fahre herunter …`);
  stopMonitor();
  stopStatusUpdater();
  stopRankingUpdater();
  stopPlaytimeTracking();
  try {
    await client.destroy();
  } catch {
    /* egal */
  }
  closeDb();
  log.ok('Sauber beendet.');
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => log.error('Unbehandelte Promise-Ablehnung:', err));
process.on('uncaughtException', (err) => log.error('Unbehandelte Ausnahme:', err));

client.login(config.token).catch((err) => {
  const meldung = String(err?.message ?? err);
  log.error('Anmeldung fehlgeschlagen:', meldung);

  if (/disallowed intents/i.test(meldung)) {
    log.error('');
    log.error('Discord lehnt einen privilegierten Intent ab. Du nutzt WELCOME_CHANNEL_ID,');
    log.error('dafür muss im Developer Portal der "Server Members Intent" aktiv sein:');
    log.error('  discord.com/developers -> deine App -> Bot -> Privileged Gateway Intents');
    log.error('  -> SERVER MEMBERS INTENT einschalten und speichern.');
    log.error('');
    log.error('Alternativ WELCOME_CHANNEL_ID leeren, dann läuft alles Übrige weiter.');
  } else {
    log.error('Prüfe, ob DISCORD_TOKEN korrekt ist.');
  }
  process.exit(1);
});

// Referenz für Diagnosezwecke, falls jemand den Zustand im Debugger braucht.
export { client, getLastState };
