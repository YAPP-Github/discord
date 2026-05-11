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
    name: "invite_github_users",
    description:
      "GitHub username 목록을 받아 YAPP Org에 일괄 초대. 사전에 멤버/대기 초대 목록을 GitHub에서 조회하여 이미 멤버이거나 대기 중인 사람은 자동 제외 (멱등). 동일 호출을 반복해도 새 사람만 초대된다.",
    input_schema: {
      type: "object",
      properties: {
        usernames: {
          type: "array",
          items: { type: "string" },
          description: "GitHub username 배열 (@ 접두사는 무시)",
        },
      },
      required: ["usernames"],
    },
    handler: async (_client, args) => {
      const raw = Array.isArray(args.usernames) ? args.usernames : [];
      return githubService.inviteMany(raw.map((u) => String(u)));
    },
  },
  {
    name: "read_thread_messages",
    description:
      "Discord 스레드/채널의 최근 메시지를 시간순으로 조회. 메시지 내용에서 GitHub username 등을 추출할 때 사용. thread_id 는 사용자가 현재 명령을 입력한 채널 ID 를 기본으로 한다.",
    input_schema: {
      type: "object",
      properties: {
        thread_id: {
          type: "string",
          description: "Discord 스레드/채널 ID",
        },
        limit: {
          type: "number",
          description: "최근 N개. 기본 100, 최대 100.",
        },
      },
      required: ["thread_id"],
    },
    handler: async (client, args) => {
      const limit = Math.min(Number(args.limit ?? 100) || 100, 100);
      const messages = await channelService.fetchThreadMessages(
        client,
        String(args.thread_id),
        limit,
      );
      return messages.filter((m) => !m.bot);
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
    name: "list_notices",
    description: "List all registered recurring notices",
    input_schema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      return noticeService.list();
    },
  },
  {
    name: "toggle_notice",
    description:
      "Flip the enabled flag of an existing notice by id. Prefer set_notice_enabled when you want a specific on/off state.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number" },
      },
      required: ["id"],
    },
    handler: async (_client, args) => {
      const row = noticeService.toggle(Number(args.id));
      if (!row) throw new Error(`notice ${args.id} not found`);
      return row;
    },
  },
  {
    name: "set_notice_enabled",
    description:
      "Set a notice's enabled state to a specific value (true=on, false=off). Use this instead of toggle_notice when the desired state is known.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "number" },
        enabled: { type: "boolean" },
      },
      required: ["id", "enabled"],
    },
    handler: async (_client, args) => {
      const row = noticeService.setEnabled(
        Number(args.id),
        Boolean(args.enabled),
      );
      if (!row) throw new Error(`notice ${args.id} not found`);
      return row;
    },
  },
  {
    name: "disable_all_notices",
    description:
      "Disable every currently enabled notice in a single call. Use when the user asks to stop, pause, or turn off all schedulers/notices at once.",
    input_schema: {
      type: "object",
      properties: {},
    },
    handler: async () => {
      const count = noticeService.disableAll();
      return { disabled_count: count };
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
