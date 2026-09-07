import { Client, GatewayIntentBits, ActivityType, Events } from 'discord.js';
import { config, validateConfig } from './config.js';
import { log } from './logger.js';
import { initDb, closeDb } from './db.js';
import { monitor, startMonitor, stopMonitor, getLastState } from './monitor.js';
import { startStatusUpdater, stopStatusUpdater, updateStatusMessage } from './statusMessage.js';
import { registerCommands, handleInteraction } from './commands.js';

if (!validateConfig()) process.exit(1);

initDb();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  // Keine Erwähnungen aus Embed-Inhalten auslösen.
  allowedMentions: { parse: [] },
});

client.once(Events.ClientReady, async (c) => {
  log.ok(`Angemeldet als ${c.user.tag}`);
  await registerCommands();
  startMonitor();
  startStatusUpdater(client);
});

client.on(Events.InteractionCreate, (interaction) => handleInteraction(interaction, client));

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
  log.error('Anmeldung fehlgeschlagen:', err?.message ?? err);
  log.error('Prüfe, ob DISCORD_TOKEN korrekt ist.');
  process.exit(1);
});

// Referenz für Diagnosezwecke, falls jemand den Zustand im Debugger braucht.
export { client, getLastState };
