import * as githubService from "../githubOrgService.js";
import * as noticeService from "../noticeService.js";
import * as channelService from "../discordChannelService.js";
import * as calendarService from "../calendarService.js";
import type { BotClient } from "../../client.js";
import { config } from "../../config.js";

export interface AgentToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  // Returns serializable result. Throws on failure.
  handler: (
    client: BotClient,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}

export const tools: AgentToolDef[] = [
  {
    name: "invite_github_user",
    description: "Invite a GitHub user to the YAPP organization",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string" },
      },
      required: ["username"],
    },
    handler: async (_client, args) => {
      return githubService.inviteUser(String(args.username));
    },
  },
  {
    name: "create_github_repo",
    description: "Create a repository under the YAPP organization",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        private: { type: "boolean" },
        template: { type: "boolean" },
      },
      required: ["name"],
    },
    handler: async (_client, args) => {
      return githubService.createRepo({
        name: String(args.name),
        private: args.private as boolean | undefined,
        template: args.template as boolean | undefined,
      });
    },
  },
  {
    name: "create_discord_channel",
    description: "Create a Discord text channel",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    },
    handler: async (client, args) => {
      return channelService.createTextChannel(client, {
        guildId: config.discord.guildId,
        name: String(args.name),
      });
    },
  },
  {
    name: "schedule_notice",
    description: "Register a recurring notice",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string" },
        cron_expr: { type: "string" },
        channel_id: { type: "string" },
      },
      required: ["title", "content", "cron_expr", "channel_id"],
    },
    handler: async (_client, args) => {
      return noticeService.create({
        title: String(args.title),
        content: String(args.content),
        cron_expr: String(args.cron_expr),
        channel_id: String(args.channel_id),
      });
    },
  },
  {
    name: "list_calendar_events",
    description: "List today's calendar events for a calendar id",
    input_schema: {
      type: "object",
      properties: {
        calendar_id: { type: "string" },
      },
      required: ["calendar_id"],
    },
    handler: async (_client, args) => {
      return calendarService.listToday(String(args.calendar_id));
    },
  },
];

export function findTool(name: string): AgentToolDef | undefined {
  return tools.find((t) => t.name === name);
}
