import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from './config.js';
import { getPlaytimeRanking } from './db.js';
import { discordTime } from './stats.js';

const NAME_WIDTH = 20;

/**
 * Spielzeit lesbar machen.
 *
 * Reine Stundenangaben mit einer Nachkommastelle sind am Anfang wertlos: alles
 * unter drei Minuten wuerde als "0,0" erscheinen. Deshalb waechst die Einheit
 * mit der Dauer mit.
 */
function hours(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} Min`;
  return `${(s / 3600).toFixed(1).replace('.', ',')} h`;
}

/**
 * Bereitet einen Spielernamen fuer die Ausgabe im Codeblock auf.
 * Backticks und Zeilenumbrueche wuerden den Block sprengen - ein Spieler
 * koennte sich sonst einen Namen geben, der die Darstellung zerlegt.
 */
function safeName(name) {
  const clean = String(name ?? '')
    .replace(/[`\r\n]/g, ' ')
    .trim();
  if (clean === '') return '(ohne Namen)';
  return clean.length > NAME_WIDTH ? `${clean.slice(0, NAME_WIDTH - 1)}…` : clean;
}

function pad(text, width, right = false) {
  const s = String(text);
  if (s.length >= width) return s;
  const fill = ' '.repeat(width - s.length);
  return right ? fill + s : s + fill;
}

/**
 * Baut die Rangliste fuer eine Seite.
 * @param {number} page 1-basierte Seitennummer
 */
export function buildRankingMessage(page = 1) {
  const days = config.rankingDays;
  const size = config.rankingPageSize;
  const now = Math.floor(Date.now() / 1000);
  const since = now - days * 86400;

  // Erst Gesamtzahl holen, damit die Seite nicht ins Leere zeigt.
  const probe = getPlaytimeRanking(since, now, { limit: 1, offset: 0 });
  const totalPages = Math.max(1, Math.ceil(probe.totalPlayers / size));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), totalPages);
  const offset = (current - 1) * size;

  const { rows, totalPlayers, totalSeconds } = getPlaytimeRanking(since, now, {
    limit: size,
    offset,
  });

  const embed = new EmbedBuilder()
    .setColor(config.accentColor)
    .setTitle('🏆 Spielzeit-Rangliste')
    .setTimestamp(new Date());

  // Bereits erfasste Daten werden immer gezeigt - auch wenn RCon gerade aus
  // ist. Der Hinweis auf die Einrichtung kommt nur, wenn wirklich nichts da ist.
  if (totalPlayers === 0) {
    embed.setDescription(
      !config.rconEnabled
        ? [
            'Die Spielzeit-Erfassung ist nicht aktiv.',
            '',
            'Sie braucht einen Zugang per **BattlEye RCon** – die normale Serverabfrage',
            'gibt bei DayZ grundsätzlich keine Spielernamen preis.',
            '',
            '-# In der `.env` `RCON_ENABLED=true` setzen und `RCON_PASSWORD` eintragen.',
          ].join('\n')
        : [
            `Für die letzten ${days} Tage liegen noch keine Spielzeiten vor.`,
            '',
            '-# Die Erfassung läuft und füllt sich fortlaufend.',
          ].join('\n')
    );
    embed.setFooter({ text: `Seite 1 von 1` });
    return { embeds: [embed], components: [] };
  }

  const header = ` ${pad('#', 3, true)}  ${pad('Spieler', NAME_WIDTH)}  ${pad('Zeit', 8, true)}  ${pad('Sitz.', 6, true)}`;
  const divider = '─'.repeat(header.length);

  const lines = rows.map((row, i) => {
    const rank = offset + i + 1;
    return ` ${pad(rank, 3, true)}  ${pad(safeName(row.name), NAME_WIDTH)}  ${pad(hours(row.seconds), 8, true)}  ${pad(row.sessions, 6, true)}`;
  });

  embed.setDescription(
    [
      `**Letzte ${days} Tage** · ${totalPlayers} Spieler · ${hours(totalSeconds)} gesamt`,
      '',
      '```',
      header,
      divider,
      ...lines,
      '```',
    ].join('\n')
  );

  // Podest der Gesamtwertung nur auf Seite 1 hervorheben.
  if (current === 1 && rows.length > 0) {
    const medals = ['🥇', '🥈', '🥉'];
    embed.addFields({
      name: 'Podest',
      value: rows
        .slice(0, 3)
        .map((r, i) => `${medals[i]} **${safeName(r.name)}** — ${hours(r.seconds)}`)
        .join('\n'),
      inline: false,
    });
  }

  const newest = rows.reduce((max, r) => Math.max(max, r.lastOnline ?? 0), 0);
  embed.setFooter({
    text: `Seite ${current} von ${totalPages}`,
  });
  if (newest > 0) {
    embed.addFields({
      name: 'Zuletzt gesehen',
      value: `Aktivster Eintrag dieser Seite war zuletzt ${discordTime(newest, 'R')} online.`,
      inline: false,
    });
  }

  return { embeds: [embed], components: buildPager(current, totalPages) };
}

function buildPager(current, totalPages) {
  if (totalPages <= 1) return [];

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rank:page:${current - 1}`)
      .setEmoji('◀️')
      .setLabel('Zurück')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(current <= 1),
    new ButtonBuilder()
      .setCustomId('rank:noop')
      .setLabel(`${current} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`rank:page:${current + 1}`)
      .setEmoji('▶️')
      .setLabel('Weiter')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(current >= totalPages)
  );

  return [row];
}
