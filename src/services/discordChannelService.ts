import type { BotClient } from "../client.js";
import { ChannelType, PermissionsBitField } from "discord.js";

const MAX_DISCORD_MESSAGE = 2000;

export async function sendMessage(
  client: BotClient,
  channelId: string,
  content: string,
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    throw new Error(`Channel not sendable: ${channelId}`);
  }
  for (const chunk of splitMessage(content)) {
    await channel.send({ content: chunk });
  }
}

export function splitMessage(content: string): string[] {
  if (content.length <= MAX_DISCORD_MESSAGE) return [content];
  const out: string[] = [];
  for (let i = 0; i < content.length; i += MAX_DISCORD_MESSAGE) {
    out.push(content.slice(i, i + MAX_DISCORD_MESSAGE));
  }
  return out;
}

export interface CreateChannelInput {
  guildId: string;
  name: string;
  parentId?: string;
  allowRoleIds?: string[];
}

export async function createTextChannel(
  client: BotClient,
  input: CreateChannelInput,
): Promise<{ id: string; name: string }> {
  const guild = await client.guilds.fetch(input.guildId);
  const overwrites = (input.allowRoleIds ?? []).map((roleId) => ({
    id: roleId,
    allow: [PermissionsBitField.Flags.ViewChannel],
  }));
  const created = await guild.channels.create({
    name: input.name,
    type: ChannelType.GuildText,
    parent: input.parentId,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      ...overwrites,
    ],
  });
  return { id: created.id, name: created.name };
}

export async function createRole(
  client: BotClient,
  guildId: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const guild = await client.guilds.fetch(guildId);
  const role = await guild.roles.create({ name });
  return { id: role.id, name: role.name };
}
