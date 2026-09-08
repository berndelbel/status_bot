import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { EmbedBuilder, Events } from 'discord.js';
import { config } from './config.js';
import { log } from './logger.js';
import { discordTime } from './stats.js';
import { resolveTextChannel, PERMS } from './channel.js';

let cached = null;

const STANDARD = {
  title: '👋 Willkommen auf {server}!',
  description: 'Schön, dass du da bist, {user}!',
  color: null,
  mentionUser: true,
  showAvatar: true,
  showMemberCount: true,
  showAccountAge: true,
  image: null,
  fields: [],
  footer: null,
};

/**
 * Laedt die Willkommens-Konfiguration.
 * Fehlt die Datei, werden sinnvolle Standardtexte benutzt - die Funktion soll
 * nicht daran scheitern, dass jemand die Vorlage nicht kopiert hat.
 */
export function loadWelcomeConfig({ force = false } = {}) {
  if (cached && !force) return cached;

  const path = resolve(config.welcomeFile);
  if (!existsSync(path)) {
    log.info(`Keine Willkommensdatei unter ${path} - es werden Standardtexte benutzt.`);
    cached = { ...STANDARD };
    return cached;
  }

  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    cached = {
      ...STANDARD,
      ...raw,
      fields: Array.isArray(raw.fields) ? raw.fields : [],
    };
  } catch (err) {
    log.error(`Willkommensdatei ${path} ist kein gültiges JSON: ${err.message}`);
    log.error('  Es werden vorläufig die Standardtexte benutzt.');
    cached = { ...STANDARD };
  }
  return cached;
}

/** Ersetzt die Platzhalter in einem Text. */
function fuellePlatzhalter(text, member) {
  if (typeof text !== 'string') return text;
  return text
    .replaceAll('{user}', member.toString())
    .replaceAll('{username}', member.displayName ?? member.user.username)
    .replaceAll('{tag}', member.user.tag ?? member.user.username)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{count}', String(member.guild.memberCount ?? '?'))
    .replaceAll('{serverip}', `${config.host}:${config.gamePort}`);
}

function parseColor(value) {
  if (!value) return config.accentColor;
  const hex = String(value).trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return config.accentColor;
  return Number.parseInt(hex, 16);
}

/**
 * Baut die Willkommensnachricht fuer ein neues Mitglied.
 * @param {import('discord.js').GuildMember} member
 */
export function buildWelcomeMessage(member) {
  const cfg = loadWelcomeConfig();

  const embed = new EmbedBuilder()
    .setColor(parseColor(cfg.color))
    .setTitle(fuellePlatzhalter(cfg.title, member)?.slice(0, 256) ?? null)
    .setDescription(fuellePlatzhalter(cfg.description, member)?.slice(0, 4096) ?? null)
    .setTimestamp(new Date());

  if (cfg.showAvatar) {
    embed.setThumbnail(member.user.displayAvatarURL({ size: 256, extension: 'png' }));
  }

  for (const field of cfg.fields.slice(0, 20)) {
    const name = fuellePlatzhalter(field?.name, member);
    const value = fuellePlatzhalter(field?.value, member);
    if (!name || !value) continue;
    embed.addFields({
      name: String(name).slice(0, 256),
      value: String(value).slice(0, 1024),
      inline: Boolean(field.inline),
    });
  }

  // Kontozeile: fuer Neulinge nett, fuer Moderatoren nuetzlich - ein Konto, das
  // vor fuenf Minuten erstellt wurde, faellt so sofort auf.
  const zusatz = [];
  if (cfg.showMemberCount && member.guild.memberCount) {
    zusatz.push(`Mitglied Nr. **${member.guild.memberCount}**`);
  }
  if (cfg.showAccountAge) {
    zusatz.push(`Konto erstellt ${discordTime(Math.floor(member.user.createdTimestamp / 1000), 'R')}`);
  }
  if (zusatz.length > 0) {
    embed.addFields({ name: '​', value: `-# ${zusatz.join(' · ')}`, inline: false });
  }

  if (cfg.image && /^https:\/\//i.test(String(cfg.image))) {
    embed.setImage(String(cfg.image));
  }
  if (cfg.footer) {
    embed.setFooter({ text: String(fuellePlatzhalter(cfg.footer, member)).slice(0, 2048) });
  }

  const payload = { embeds: [embed] };

  // Der Client unterdrueckt Erwaehnungen global. Damit das neue Mitglied den
  // Ping trotzdem bekommt, wird er hier gezielt wieder erlaubt.
  if (cfg.mentionUser) {
    payload.content = member.toString();
    payload.allowedMentions = { users: [member.id] };
  }

  return payload;
}

/**
 * Sendet die Willkommensnachricht in den konfigurierten Channel.
 *
 * Bewusst als gemeinsame Funktion: der Beitritts-Handler und der Testbefehl
 * nehmen exakt denselben Weg. Sonst wuerde der Test etwas anderes pruefen als
 * das, was im Ernstfall passiert.
 *
 * @returns {Promise<{ok: boolean, grund?: string, url?: string}>}
 */
export async function sendWelcome(client, member) {
  if (!config.welcomeChannelId) {
    return { ok: false, grund: 'WELCOME_CHANNEL_ID ist nicht gesetzt.' };
  }

  const channel = await resolveTextChannel(
    client,
    config.welcomeChannelId,
    'Willkommen',
    PERMS.postOnly
  );
  if (!channel) {
    return {
      ok: false,
      grund:
        'Der Channel ist nicht erreichbar oder dem Bot fehlen dort Rechte. ' +
        'Er braucht: Kanal ansehen, Nachrichten senden, Links einbetten. Details stehen im Log.',
    };
  }

  const message = await channel.send(buildWelcomeMessage(member));
  return { ok: true, url: message.url };
}

/**
 * Haengt den Handler fuer neue Mitglieder an den Client.
 *
 * Bewusst hier und nicht in index.js: sendWelcome liegt im selben Modul, damit
 * kann kein fehlender Import dazwischenkommen.
 */
export function registerWelcomeHandler(client) {
  client.on(Events.GuildMemberAdd, async (member) => {
    if (!config.welcomeChannelId) return;
    if (member.user.bot && !config.welcomeGreetBots) return;

    log.info(`Neues Mitglied: ${member.user.tag}`);
    try {
      const ergebnis = await sendWelcome(client, member);
      if (ergebnis.ok) log.ok(`Willkommensnachricht gesendet: ${ergebnis.url}`);
      else log.error(`Willkommensnachricht nicht gesendet: ${ergebnis.grund}`);
    } catch (err) {
      log.error(`Willkommensnachricht fehlgeschlagen: ${err?.message ?? err}`);
    }
  });
}
