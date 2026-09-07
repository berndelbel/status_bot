import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  AttachmentBuilder,
} from 'discord.js';
import { config } from './config.js';
import { renderChart } from './chart.js';
import {
  RANGES,
  collectStats,
  buildSeries,
  playerTrend,
  formatDuration,
  formatPercent,
  discordTime,
} from './stats.js';

const CHART_FILE = 'verlauf.png';

/** Zeichenlimits von Discord. Ein Ueberschreiten laesst das ganze Embed scheitern. */
const LIMIT = {
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
};

/**
 * Kuerzt Text auf ein Discord-Limit.
 * Servername, Karte und Ingame-Zeit stammen aus der Antwort des DayZ-Servers -
 * also aus fremder Quelle. Ohne Begrenzung koennte ein ueberlanger Wert die
 * gesamte Status-Nachricht blockieren.
 */
function clamp(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Auslastungsbalken aus Blockzeichen - wirkt in Discord wie ein echter Progressbar. */
function bar(value, max, width = 18) {
  if (!max || max <= 0) return '▱'.repeat(width);
  const ratio = Math.min(1, Math.max(0, value / max));
  const filled = Math.round(ratio * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

function trendIcon(trend) {
  if (!trend) return '';
  if (trend.direction === 'up') return ` 📈 +${trend.diff}`;
  if (trend.direction === 'down') return ` 📉 −${trend.diff}`;
  return '';
}

/**
 * Baut die komplette Status-Nachricht (Embed + Graph + Bedienelemente).
 * @param {object} state Ergebnis aus queryServer()
 */
export function buildStatusMessage(state) {
  const stats = collectStats(config.chartHours);
  const series = buildSeries(config.chartHours, 96);
  const online = state.online;

  const rangeLabel =
    Object.values(RANGES).find((r) => r.hours === config.chartHours)?.label ??
    `Letzte ${config.chartHours} Stunden`;

  const chartPng = renderChart(series, {
    hours: config.chartHours,
    label: rangeLabel,
    slots: state.maxPlayers || stats.slots,
    current: online ? state.players : null,
    peak: stats.peak,
    avg: stats.avg,
  });
  const attachment = new AttachmentBuilder(chartPng, { name: CHART_FILE });

  const embed = new EmbedBuilder()
    .setColor(online ? config.accentColor : config.offlineColor)
    .setAuthor({ name: 'DayZ Serverstatus' })
    .setTitle(
      clamp(`${online ? '🟢' : '🔴'}  ${state.name ?? config.serverNameOverride ?? 'DayZ Server'}`, LIMIT.title)
    )
    .setDescription(
      clamp(
        online ? onlineDescription(state, stats) : offlineDescription(state, stats),
        LIMIT.description
      )
    )
    .setImage(`attachment://${CHART_FILE}`)
    .setTimestamp(new Date())
    .setFooter({ text: `Aktualisiert alle ${config.updateInterval} Sekunden` });

  if (config.mapImageUrl) embed.setThumbnail(config.mapImageUrl);

  addFields(embed, state, stats);

  return { embeds: [embed], files: [attachment], components: buildComponents(state) };
}

function onlineDescription(state, stats) {
  const trend = playerTrend(state.players, 1);
  const lines = [];

  const uptimeSince =
    stats.streak?.online && stats.streak.since
      ? ` · online seit ${discordTime(stats.streak.since, 'R')}`
      : '';
  lines.push(`**Online**${uptimeSince}`);
  lines.push('');
  lines.push(`### 👥 ${state.players} / ${state.maxPlayers} Spieler${trendIcon(trend)}`);
  lines.push(
    `\`${bar(state.players, state.maxPlayers)}\`  **${percentOf(state.players, state.maxPlayers)}**`
  );

  if (state.queue > 0) {
    lines.push(`🚪 **${state.queue}** ${state.queue === 1 ? 'Spieler wartet' : 'Spieler warten'} in der Warteschlange`);
  }

  return lines.join('\n');
}

function offlineDescription(state, stats) {
  const lines = [];
  const downSince = stats.streak && !stats.streak.online ? stats.streak.since : null;

  lines.push(
    downSince
      ? `**Offline** · nicht erreichbar seit ${discordTime(downSince, 'R')}`
      : '**Offline** · Server antwortet nicht'
  );
  lines.push('');
  lines.push('### 🔌 Keine Verbindung zum Server');
  lines.push(
    'Der Server antwortet nicht auf Abfragen. Das passiert normalerweise bei einem Neustart oder Update.'
  );

  if (state.error) {
    const short = String(state.error).slice(0, 150);
    lines.push(`-# Grund: ${short}`);
  }
  return lines.join('\n');
}

function percentOf(value, max) {
  if (!max || max <= 0) return '–';
  return `${Math.round((value / max) * 100)} %`;
}

function addFields(embed, state, stats) {
  const fields = [];

  fields.push({
    name: '⏱️ Uptime',
    value:
      stats.uptimeRatio !== null
        ? `**${formatPercent(stats.uptimeRatio)}**\n-# ${stats.hours} Std · ${stats.outageCount} ${
            stats.outageCount === 1 ? 'Ausfall' : 'Ausfälle'
          }`
        : '**–**\n-# noch keine Daten',
    inline: true,
  });

  fields.push({
    name: '📈 Peak',
    value:
      stats.peak !== null
        ? `**${stats.peak}** Spieler\n-# ${stats.peakAt ? discordTime(stats.peakAt, 't') : ''}`
        : '**–**\n-# noch keine Daten',
    inline: true,
  });

  fields.push({
    name: '📊 Durchschnitt',
    value: stats.avg !== null ? `**${String(stats.avg).replace('.', ',')}** Spieler\n-# über ${stats.hours} Std` : '**–**',
    inline: true,
  });

  if (state.online) {
    fields.push({
      name: '🗺️ Karte',
      value: `**${prettyMap(state.map)}**`,
      inline: true,
    });

    fields.push({
      name: '🕐 Ingame-Zeit',
      value: state.ingameTime ? `**${state.ingameTime}**` : '**–**',
      inline: true,
    });

    fields.push({
      name: '📶 Ping',
      value: state.ping !== null ? `**${state.ping} ms**` : '**–**',
      inline: true,
    });

    const tags = [];
    if (state.firstPerson) tags.push('First Person');
    if (state.password) tags.push('🔒 Passwort');
    if (state.privateHive) tags.push('Private Hive');
    if (state.mods.length > 0) tags.push(`${state.mods.length} Mods`);
    if (tags.length > 0) {
      fields.push({ name: '🏷️ Merkmale', value: tags.join(' · '), inline: false });
    }
  } else if (stats.downtimeSeconds > 0) {
    fields.push({
      name: '⚠️ Ausfallzeit',
      value: `**${formatDuration(stats.downtimeSeconds)}**\n-# in den letzten ${stats.hours} Std`,
      inline: true,
    });
  }

  fields.push({
    name: '🔗 Verbinden',
    value: `\`\`\`\n${config.host}:${config.gamePort}\n\`\`\``,
    inline: false,
  });

  // Zentral kappen statt an jeder einzelnen Stelle - so kann kein Feld das
  // gesamte Embed zu Fall bringen.
  embed.addFields(
    fields.map((f) => ({
      name: clamp(f.name, LIMIT.fieldName),
      value: clamp(f.value, LIMIT.fieldValue),
      inline: f.inline,
    }))
  );
}

function prettyMap(map) {
  if (!map) return '–';
  const known = {
    chernarusplus: 'Chernarus',
    chernarus: 'Chernarus',
    enoch: 'Livonia',
    livonia: 'Livonia',
    sakhal: 'Sakhal',
    namalsk: 'Namalsk',
    deerisle: 'Deer Isle',
    banov: 'Banov',
    esseker: 'Esseker',
    takistanplus: 'Takistan',
  };
  const key = map.toLowerCase().trim();
  return known[key] ?? map.charAt(0).toUpperCase() + map.slice(1);
}

export function buildComponents(state) {
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('status:refresh')
      .setLabel('Aktualisieren')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('status:connect')
      .setLabel('Verbinden')
      .setEmoji('🎮')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('status:players')
      .setLabel('Spielerliste')
      .setEmoji('👥')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!state?.online)
  );

  const select = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('status:range')
      .setPlaceholder('📊 Verlauf für einen anderen Zeitraum anzeigen …')
      .addOptions(
        Object.entries(RANGES).map(([key, r]) => ({
          label: r.label,
          value: key,
          emoji: '📈',
        }))
      )
  );

  return [buttons, select];
}

/** Eigenstaendiger Verlaufs-Graph fuer die Auswahl im Dropdown / den Slash-Command. */
export function buildRangeMessage(rangeKey, state) {
  const range = RANGES[rangeKey] ?? RANGES['24h'];
  const stats = collectStats(range.hours);
  const buckets = range.hours <= 6 ? 60 : range.hours <= 48 ? 96 : 120;
  const series = buildSeries(range.hours, buckets);

  const png = renderChart(series, {
    hours: range.hours,
    label: range.label,
    slots: state?.maxPlayers || stats.slots,
    current: state?.online ? state.players : null,
    peak: stats.peak,
    avg: stats.avg,
  });

  const embed = new EmbedBuilder()
    .setColor(config.accentColor)
    .setTitle(clamp(`📊 Spielerverlauf · ${range.label}`, LIMIT.title))
    .setImage(`attachment://${CHART_FILE}`)
    .addFields(
      {
        name: '📈 Peak',
        value: stats.peak !== null ? `**${stats.peak}** Spieler` : '–',
        inline: true,
      },
      {
        name: '📊 Durchschnitt',
        value: stats.avg !== null ? `**${String(stats.avg).replace('.', ',')}**` : '–',
        inline: true,
      },
      {
        name: '⏱️ Uptime',
        value: stats.uptimeRatio !== null ? `**${formatPercent(stats.uptimeRatio)}**` : '–',
        inline: true,
      }
    )
    .setFooter({
      text:
        stats.samples > 0
          ? `${stats.samples} Messungen · ${stats.outageCount} Ausfälle · ${formatDuration(
              stats.downtimeSeconds
            )} offline`
          : 'Noch keine Messungen in diesem Zeitraum',
    });

  return {
    embeds: [embed],
    files: [new AttachmentBuilder(png, { name: CHART_FILE })],
  };
}
