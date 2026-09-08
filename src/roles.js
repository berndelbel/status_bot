import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from './config.js';
import { log } from './logger.js';

/** Discord erlaubt hoechstens 5 Reihen mit je 5 Knoepfen. */
const MAX_ROWS = 5;
const MAX_PER_ROW = 5;
const MAX_BUTTONS = MAX_ROWS * MAX_PER_ROW;

let cached = null;

/**
 * Laedt die Rollenkonfiguration aus der JSON-Datei.
 * Gibt null zurueck, wenn keine Datei da ist - das Feature ist dann schlicht aus.
 */
export function loadRolesConfig({ force = false } = {}) {
  if (cached && !force) return cached;

  const path = resolve(config.rolesFile);
  if (!existsSync(path)) {
    log.info(`Keine Rollendatei unter ${path} - Reaction Roles sind deaktiviert.`);
    return null;
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    log.error(`Rollendatei ${path} ist kein gültiges JSON: ${err.message}`);
    log.error('  Häufigste Ursache: ein Komma zu viel vor einer schließenden Klammer.');
    return null;
  }

  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  const roles = [];

  for (const group of groups) {
    if (!Array.isArray(group?.roles)) continue;
    for (const role of group.roles) {
      if (!role?.id || !/^\d{17,20}$/.test(String(role.id))) {
        log.warn(`Rolle "${role?.label ?? '?'}" hat keine gültige ID und wird übersprungen.`);
        continue;
      }
      const label = String(role.label ?? 'Rolle').slice(0, 80);
      roles.push({
        id: String(role.id),
        label,
        emoji: pruefeEmoji(role.emoji, label),
        description: role.description ? String(role.description) : null,
        group: group.name ?? null,
      });
    }
  }

  if (roles.length === 0) {
    log.warn('Rollendatei enthält keine verwendbaren Rollen.');
    return null;
  }

  if (roles.length > MAX_BUTTONS) {
    log.warn(
      `${roles.length} Rollen konfiguriert, Discord erlaubt aber nur ${MAX_BUTTONS} Knöpfe. ` +
        `Die überzähligen werden nicht angezeigt.`
    );
  }

  // Doppelte Rollen-IDs wuerden zu doppelten customIds fuehren - Discord lehnt
  // die Nachricht dann komplett ab.
  const gesehen = new Set();
  const eindeutig = roles.filter((r) => {
    if (gesehen.has(r.id)) {
      log.warn(`Rolle ${r.id} ("${r.label}") ist mehrfach eingetragen - nur der erste Eintrag zählt.`);
      return false;
    }
    gesehen.add(r.id);
    return true;
  });

  cached = {
    title: String(raw.title ?? 'Wähle deine Rollen').slice(0, 256),
    description: String(
      raw.description ?? 'Klick auf einen Knopf, um dir die Rolle zu geben oder wieder abzugeben.'
    ).slice(0, 2000),
    groups,
    roles: eindeutig.slice(0, MAX_BUTTONS),
  };
  return cached;
}

/**
 * Prueft gegen den echten Server, ob die Rollen vergeben werden koennen.
 *
 * Die zwei haeufigsten Stolperfallen: die Rolle existiert nicht mehr, oder sie
 * steht in der Rangfolge ueber der Bot-Rolle. Discord verweigert die Vergabe
 * dann kommentarlos - deshalb hier vorab pruefen und klar melden.
 */
export async function validateRoles(guild) {
  const cfg = loadRolesConfig();
  if (!cfg) return { ok: false, problems: ['Keine Rollenkonfiguration geladen.'] };

  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me) return { ok: false, problems: ['Eigenes Mitgliedsobjekt nicht abrufbar.'] };

  const problems = [];

  if (!me.permissions.has('ManageRoles')) {
    problems.push('Dem Bot fehlt das Recht "Rollen verwalten".');
  }

  const eigenePosition = me.roles.highest.position;

  for (const eintrag of cfg.roles) {
    const rolle = guild.roles.cache.get(eintrag.id) ?? (await guild.roles.fetch(eintrag.id).catch(() => null));

    if (!rolle) {
      problems.push(`Rolle ${eintrag.id} ("${eintrag.label}") existiert auf diesem Server nicht.`);
      continue;
    }
    if (rolle.managed) {
      problems.push(`"${rolle.name}" wird von einer Integration verwaltet und kann nicht vergeben werden.`);
      continue;
    }
    if (rolle.position >= eigenePosition) {
      problems.push(
        `"${rolle.name}" steht in der Rangfolge über der Bot-Rolle - der Bot kann sie nicht vergeben. ` +
          `Bot-Rolle in den Servereinstellungen nach oben ziehen.`
      );
    }
  }

  return { ok: problems.length === 0, problems };
}

/** Eigene Server-Emojis: <:name:id> bzw. <a:name:id> fuer animierte. */
const CUSTOM_EMOJI = /^<(a?):([\w~]{2,32}):(\d{17,20})>$/;

/** Ziffern-Emojis wie 1️⃣ bestehen aus Ziffer + Variantenzeichen + Keycap. */
const KEYCAP = /^[0-9#*]️?⃣$/;

/**
 * Prueft, ob ein Emoji fuer Discord brauchbar ist.
 *
 * Discord lehnt eine Nachricht komplett ab, wenn auch nur ein Knopf ein
 * ungueltiges Emoji traegt (COMPONENT_INVALID_EMOJI). Ein kosmetischer
 * Tippfehler darf aber nicht die ganze Rollen-Nachricht verhindern - deshalb
 * wird hier aussortiert und gemeldet statt durchgereicht.
 */
function pruefeEmoji(value, label) {
  if (!value) return null;
  const raw = String(value).trim();
  if (raw === '') return null;

  if (CUSTOM_EMOJI.test(raw)) return raw;
  if (KEYCAP.test(raw)) return raw;

  const hatPiktogramm = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(raw);
  // Buchstaben oder Doppelpunkte deuten auf einen Namen wie ":coin:" hin -
  // das ist kein Emoji, sondern nur dessen Schreibweise im Chat.
  const hatSchriftzeichen = /[A-Za-z:]/.test(raw);

  if (hatPiktogramm && !hatSchriftzeichen) return raw;

  log.warn(`Emoji "${raw}" bei Rolle "${label}" ist ungültig und wird weggelassen.`);
  log.warn('  Erlaubt sind echte Emojis (📢) oder eigene Server-Emojis als <:name:id>.');
  log.warn('  Die Schreibweise :name: funktioniert hier nicht.');
  return null;
}

/** Wandelt einen geprueften Emoji-String in das Format, das discord.js erwartet. */
function parseEmoji(value) {
  if (!value) return null;
  const custom = value.match(CUSTOM_EMOJI);
  if (custom) return { animated: custom[1] === 'a', name: custom[2], id: custom[3] };
  return value; // Unicode-Emoji
}

/** Baut Embed und Knopfreihen fuer die Rollen-Nachricht. */
export function buildRolesMessage(memberRoleIds = null) {
  const cfg = loadRolesConfig();
  if (!cfg) return null;

  const embed = new EmbedBuilder()
    .setColor(config.accentColor)
    .setTitle(cfg.title)
    .setDescription(cfg.description);

  // Je Gruppe ein Feld - das gliedert die Liste und erklaert die Knoepfe.
  for (const group of cfg.groups) {
    const eintraege = (group?.roles ?? [])
      .map((r) => cfg.roles.find((x) => x.id === String(r?.id)))
      .filter(Boolean);
    if (eintraege.length === 0) continue;

    embed.addFields({
      name: String(group.name ?? 'Rollen').slice(0, 256),
      value: eintraege
        .map((r) => {
          const marke = memberRoleIds?.has(r.id) ? '✅' : '▫️';
          const text = `${marke} ${r.emoji ?? ''} **${r.label}**`.replace(/\s+/g, ' ');
          return r.description ? `${text}\n-# ${r.description}` : text;
        })
        .join('\n')
        .slice(0, 1024),
      inline: false,
    });
  }

  embed.setFooter({ text: 'Nochmal klicken nimmt die Rolle wieder weg.' });

  // Knoepfe in Reihen zu je fuenf.
  const rows = [];
  for (let i = 0; i < cfg.roles.length; i += MAX_PER_ROW) {
    const row = new ActionRowBuilder();
    for (const r of cfg.roles.slice(i, i + MAX_PER_ROW)) {
      const button = new ButtonBuilder()
        .setCustomId(`role:toggle:${r.id}`)
        .setLabel(r.label)
        .setStyle(memberRoleIds?.has(r.id) ? ButtonStyle.Success : ButtonStyle.Secondary);

      const emoji = parseEmoji(r.emoji);
      if (emoji) button.setEmoji(emoji);
      row.addComponents(button);
    }
    rows.push(row);
  }

  return { embeds: [embed], components: rows.slice(0, MAX_ROWS) };
}

/** Findet den Konfigurationseintrag zu einer Rollen-ID. */
export function findRole(roleId) {
  return loadRolesConfig()?.roles.find((r) => r.id === roleId) ?? null;
}
