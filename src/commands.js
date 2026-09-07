import {
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from './config.js';
import { log, describeError } from './logger.js';
import { getLastState, pollOnce } from './monitor.js';
import { buildStatusMessage, buildRangeMessage } from './embed.js';
import { buildRankingMessage } from './ranking.js';
import { updateStatusMessage, META_MESSAGE } from './statusMessage.js';
import { updateRankingMessage, META_RANK_MESSAGE } from './rankingMessage.js';
import { getOnlinePlayers, isRconConnected } from './playtime.js';
import { deleteMeta } from './db.js';
import { RANGES, collectStats, formatDuration, formatPercent, discordTime } from './stats.js';

const EPHEMERAL = MessageFlags.Ephemeral;

const rangeChoices = Object.entries(RANGES).map(([value, r]) => ({ name: r.label, value }));

export const commands = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Zeigt den aktuellen Serverstatus als Momentaufnahme'),

  new SlashCommandBuilder()
    .setName('verlauf')
    .setDescription('Zeigt den Spielerverlauf als Graph')
    .addStringOption((o) =>
      o
        .setName('zeitraum')
        .setDescription('Welcher Zeitraum soll dargestellt werden?')
        .addChoices(...rangeChoices)
    ),

  new SlashCommandBuilder()
    .setName('uptime')
    .setDescription('Zeigt Verfügbarkeit und die letzten Ausfälle'),

  new SlashCommandBuilder()
    .setName('spieler')
    .setDescription('Zeigt die aktuell verbundenen Spieler (sofern der Server sie preisgibt)'),

  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Zeigt die Spielzeit-Rangliste')
    .addIntegerOption((o) =>
      o.setName('seite').setDescription('Welche Seite? (Standard: 1)').setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName('statusnachricht')
    .setDescription('Erstellt eine dauerhafte Nachricht neu (nur Admins)')
    .addStringOption((o) =>
      o
        .setName('welche')
        .setDescription('Welche Nachricht soll neu erstellt werden?')
        .addChoices(
          { name: 'Status', value: 'status' },
          { name: 'Rangliste', value: 'ranking' },
          { name: 'Beide', value: 'both' }
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((c) => c.toJSON());

export async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    if (config.guildId) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
        body: commands,
      });
      log.ok(`${commands.length} Slash-Commands für Server ${config.guildId} registriert`);
    } else {
      await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
      log.ok(`${commands.length} Slash-Commands global registriert (bis zu 1 Std Verzögerung)`);
    }
  } catch (err) {
    log.error('Slash-Commands konnten nicht registriert werden:', err?.message ?? err);
  }
}

// ------------------------------------------------------------------ Handler

/**
 * Liefert den zuletzt bekannten Serverzustand, notfalls per frischer Abfrage.
 * Gibt null zurueck, wenn noch nie eine Abfrage durchgelaufen ist - direkt nach
 * dem Start ist das kurzzeitig moeglich.
 */
async function currentState() {
  return getLastState() ?? (await pollOnce()) ?? null;
}

const NO_DATA = {
  content:
    '⏳ Es liegt noch keine Messung vor. Der Bot fragt den Server gerade zum ersten Mal ab – versuch es in ein paar Sekunden noch einmal.',
};

export async function handleInteraction(interaction, client) {
  try {
    if (interaction.isChatInputCommand()) return await handleCommand(interaction, client);
    if (interaction.isButton()) return await handleButton(interaction, client);
    if (interaction.isStringSelectMenu()) return await handleSelect(interaction);
  } catch (err) {
    log.error('Fehler bei einer Interaktion:');
    log.error(describeError(err));
    const reply = { content: '⚠️ Da ist etwas schiefgelaufen. Versuch es gleich noch einmal.', flags: EPHEMERAL };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
}

async function handleCommand(interaction, client) {
  switch (interaction.commandName) {
    case 'status': {
      await interaction.deferReply({ flags: EPHEMERAL });
      const state = await currentState();
      if (!state) return interaction.editReply(NO_DATA);
      const payload = buildStatusMessage(state);
      // Momentaufnahme ohne Bedienelemente - die gehören zur dauerhaften Nachricht.
      return interaction.editReply({ embeds: payload.embeds, files: payload.files });
    }

    case 'verlauf': {
      await interaction.deferReply();
      const key = interaction.options.getString('zeitraum') ?? '24h';
      return interaction.editReply(buildRangeMessage(key, getLastState()));
    }

    case 'uptime': {
      await interaction.deferReply({ flags: EPHEMERAL });
      return interaction.editReply({ embeds: [buildUptimeEmbed()] });
    }

    case 'spieler': {
      await interaction.deferReply({ flags: EPHEMERAL });
      const state = await currentState();
      if (!state) return interaction.editReply(NO_DATA);
      return interaction.editReply({ embeds: [buildPlayerEmbed(state)] });
    }

    case 'ranking': {
      await interaction.deferReply({ flags: EPHEMERAL });
      const page = interaction.options.getInteger('seite') ?? 1;
      return interaction.editReply(buildRankingMessage(page));
    }

    case 'statusnachricht': {
      await interaction.deferReply({ flags: EPHEMERAL });
      const which = interaction.options.getString('welche') ?? 'status';
      const done = [];

      if (which === 'status' || which === 'both') {
        deleteMeta(META_MESSAGE);
        await updateStatusMessage(client);
        done.push('Status-Nachricht');
      }
      if (which === 'ranking' || which === 'both') {
        if (!config.rankingChannelId) {
          return interaction.editReply({
            content: '⚠️ Es ist keine `RANKING_CHANNEL_ID` konfiguriert.',
          });
        }
        deleteMeta(META_RANK_MESSAGE);
        await updateRankingMessage(client);
        done.push('Rangliste');
      }

      return interaction.editReply({ content: `✅ Neu erstellt: ${done.join(' und ')}.` });
    }

    default:
      return interaction.reply({ content: 'Unbekannter Befehl.', flags: EPHEMERAL });
  }
}

async function handleButton(interaction, client) {
  // Blaettern in der Rangliste.
  if (interaction.customId.startsWith('rank:page:')) {
    const page = Number.parseInt(interaction.customId.split(':')[2], 10) || 1;
    const payload = buildRankingMessage(page);

    // Kam der Klick aus einer privaten Antwort, dort weiterblaettern. Von der
    // dauerhaften Nachricht aus privat antworten, damit die Seite nicht unter
    // anderen Lesern wegspringt.
    if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
      return interaction.update(payload);
    }
    return interaction.reply({ ...payload, flags: EPHEMERAL });
  }
  if (interaction.customId === 'rank:noop') return interaction.deferUpdate();

  switch (interaction.customId) {
    case 'status:refresh': {
      await interaction.deferReply({ flags: EPHEMERAL });
      await pollOnce();
      await updateStatusMessage(client);
      return interaction.editReply({ content: '🔄 Status wurde neu abgefragt.' });
    }

    case 'status:connect': {
      const address = `${config.host}:${config.gamePort}`;
      const embed = new EmbedBuilder()
        .setColor(config.accentColor)
        .setTitle('🎮 So verbindest du dich')
        .setDescription(
          [
            '**1.** DayZ starten und im Hauptmenü auf **Community** gehen.',
            '**2.** Rechts unten auf **Direkt-Verbindung** klicken.',
            '**3.** Diese Adresse eintragen:',
            '',
            `\`\`\`\n${address}\n\`\`\``,
            '-# Tipp: Über das Steam-Serverbrowser-Fenster funktioniert die Adresse ebenfalls.',
          ].join('\n')
        );
      return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
    }

    case 'status:players': {
      await interaction.deferReply({ flags: EPHEMERAL });
      const state = await currentState();
      if (!state) return interaction.editReply(NO_DATA);
      return interaction.editReply({ embeds: [buildPlayerEmbed(state)] });
    }

    default:
      return interaction.reply({ content: 'Unbekannte Schaltfläche.', flags: EPHEMERAL });
  }
}

async function handleSelect(interaction) {
  if (interaction.customId !== 'status:range') return;
  await interaction.deferReply({ flags: EPHEMERAL });
  const key = interaction.values[0];
  return interaction.editReply(buildRangeMessage(key, getLastState()));
}

// ------------------------------------------------------------------ Embeds

function buildUptimeEmbed() {
  const day = collectStats(24);
  const week = collectStats(24 * 7);
  const month = collectStats(24 * 30);

  const embed = new EmbedBuilder()
    .setColor(config.accentColor)
    .setTitle('⏱️ Verfügbarkeit')
    .addFields(
      { name: '24 Stunden', value: formatPercent(day.uptimeRatio), inline: true },
      { name: '7 Tage', value: formatPercent(week.uptimeRatio), inline: true },
      { name: '30 Tage', value: formatPercent(month.uptimeRatio), inline: true }
    );

  const streak = day.streak;
  if (streak) {
    embed.setDescription(
      streak.online
        ? `🟢 **Ununterbrochen online** seit ${discordTime(streak.since, 'F')} (${discordTime(streak.since, 'R')})`
        : `🔴 **Offline** seit ${discordTime(streak.since, 'F')} (${discordTime(streak.since, 'R')})`
    );
  }

  const recent = week.outages.slice(-8).reverse();
  embed.addFields({
    name: `⚠️ Ausfälle der letzten 7 Tage (${week.outageCount})`,
    value:
      recent.length > 0
        ? recent
            .map(
              (o) =>
                `• ${discordTime(o.from, 'f')} — **${formatDuration(o.seconds)}**${
                  o.ongoing ? ' _(läuft noch)_' : ''
                }`
            )
            .join('\n')
        : '_Keine Ausfälle aufgezeichnet._',
    inline: false,
  });

  embed.setFooter({
    text: `Basiert auf ${month.samples} Messungen · Aufzeichnung alle ${config.pollInterval} s`,
  });
  return embed;
}

/**
 * Entschaerft einen Spielernamen fuer die Ausgabe.
 * Backticks und Zeilenumbrueche wuerden die Formatierung zerlegen - ein Spieler
 * koennte sich sonst einen Namen geben, der die Anzeige kaputt macht.
 */
function sanitizeName(name) {
  const clean = String(name ?? '').replace(/[`\r\n]/g, ' ').trim();
  return clean === '' ? '(ohne Namen)' : clean;
}

function buildPlayerEmbed(state) {
  const embed = new EmbedBuilder().setColor(
    state.online ? config.accentColor : config.offlineColor
  );

  if (!state.online) {
    return embed.setTitle('🔴 Server offline').setDescription('Aktuell sind keine Spieler abrufbar.');
  }

  embed.setTitle(`👥 ${state.players} / ${state.maxPlayers} Spieler online`);

  // RCon kennt die echten Namen - die Serverabfrage gibt bei DayZ keine preis.
  const rconPlayers = isRconConnected() ? getOnlinePlayers() : [];
  if (rconPlayers.length > 0) {
    const names = rconPlayers
      .map((p) => p.name)
      .sort((a, b) => a.localeCompare(b, 'de'))
      .slice(0, 60)
      .map((n, i) => `\`${String(i + 1).padStart(2, ' ')}.\` ${sanitizeName(n)}`);

    const blocks = [];
    for (let i = 0; i < names.length; i += 20) blocks.push(names.slice(i, i + 20).join('\n'));
    blocks.forEach((chunk, i) => {
      embed.addFields({ name: i === 0 ? 'Verbunden' : '​', value: chunk, inline: true });
    });
    if (rconPlayers.length > 60) {
      embed.setFooter({ text: `… und ${rconPlayers.length - 60} weitere` });
    }
    return embed;
  }

  if (state.playerList.length === 0) {
    embed.setDescription(
      [
        'Dieser Server gibt **keine Spielernamen** über die Serverabfrage preis.',
        '',
        '-# Das ist bei DayZ die Standardeinstellung und lässt sich nur serverseitig ändern. Die Spieleranzahl und der Verlauf funktionieren davon unabhängig.',
      ].join('\n')
    );
    return embed;
  }

  const names = state.playerList
    .slice(0, 60)
    .map((n, i) => `\`${String(i + 1).padStart(2, ' ')}.\` ${n}`);
  const chunks = [];
  for (let i = 0; i < names.length; i += 20) chunks.push(names.slice(i, i + 20).join('\n'));

  chunks.forEach((chunk, i) => {
    embed.addFields({ name: i === 0 ? 'Verbunden' : '​', value: chunk, inline: true });
  });

  if (state.playerList.length > 60) {
    embed.setFooter({ text: `… und ${state.playerList.length - 60} weitere` });
  }
  return embed;
}
