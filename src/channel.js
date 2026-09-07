import { ChannelType, PermissionsBitField } from 'discord.js';
import { log } from './logger.js';

const REQUIRED_PERMS = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.EmbedLinks,
  PermissionsBitField.Flags.AttachFiles,
  PermissionsBitField.Flags.ReadMessageHistory,
];

/**
 * Holt einen Textkanal und prueft, ob der Bot dort alles darf, was er braucht.
 * Gibt null zurueck und meldet die Ursache, statt spaeter unklar zu scheitern.
 */
export async function resolveTextChannel(client, channelId, label) {
  if (!channelId) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    log.error(`${label}: Channel ${channelId} nicht gefunden. Stimmt die ID?`);
    return null;
  }
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    log.error(`${label}: Der konfigurierte Channel ist kein Textkanal.`);
    return null;
  }

  const me = channel.guild.members.me ?? (await channel.guild.members.fetchMe().catch(() => null));
  if (!me) {
    log.error(`${label}: Eigenes Mitgliedsobjekt nicht abrufbar - Rechte nicht prüfbar.`);
    return null;
  }

  const missing = channel.permissionsFor(me)?.missing(REQUIRED_PERMS) ?? REQUIRED_PERMS;
  if (missing.length > 0) {
    log.error(`${label}: Dem Bot fehlen Rechte in #${channel.name}: ${missing.join(', ')}`);
    return null;
  }
  return channel;
}
