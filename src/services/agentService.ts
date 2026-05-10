import type Anthropic from "@anthropic-ai/sdk";
import { getClaudeClient } from "./claude.js";
import * as registry from "./agent/toolRegistry.js";
import * as repo from "../db/repositories/agentRepository.js";
import type { BotClient } from "../client.js";
import { logger } from "../utils/logger.js";

const MODEL = "claude-opus-4-7";
const MAX_ITERATIONS = 5;
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = [
  "당신은 YAPP 자동화 비서입니다.",
  "사용자의 요청을 달성하기 위해 등록된 툴을 호출하세요.",
  "각 툴 결과를 본 뒤 추가 호출이 필요한지 판단하세요.",
  "요청이 모두 처리되었으면 더이상 툴을 호출하지 말고 한국어로 짧게 결과를 요약해 답하세요.",
  "공지의 on/off 상태가 명확할 때는 toggle_notice 대신 set_notice_enabled 또는 disable_all_notices 를 사용하세요.",
].join(" ");

export interface AgentRunResult {
  session_id: number;
  status: "executed" | "failed";
  tool_results: {
    tool: string;
    status: "ok" | "failed";
    detail: unknown;
  }[];
  summary: string;
}

export async function run(
  client: BotClient,
  actorDiscordId: string | null,
  inputText: string,
): Promise<AgentRunResult> {
  const session = repo.createSession(actorDiscordId, inputText);
  const claude = getClaudeClient();
  const toolDefs: Anthropic.Tool[] = registry.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }));

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: inputText },
  ];

  const results: AgentRunResult["tool_results"] = [];
  let summary = "";
  let truncated = false;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const res = await claude.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: toolDefs,
      messages,
    });

    messages.push({ role: "assistant", content: res.content });

    const textParts = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text);
    if (textParts.length > 0) {
      summary = textParts.join("\n").trim();
    }

    const toolUses = res.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (toolUses.length === 0) {
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUses) {
      const args = (block.input ?? {}) as Record<string, unknown>;
      const tool = registry.findTool(block.name);
      if (!tool) {
        repo.recordToolCall(
          session.id,
          block.name,
          args,
          { error: "unknown tool" },
          "failed",
          0,
        );
        results.push({
          tool: block.name,
          status: "failed",
          detail: "unknown tool",
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ error: "unknown tool" }),
          is_error: true,
        });
        continue;
      }
      const start = Date.now();
      try {
        const detail = await tool.handler(client, args);
        const dur = Date.now() - start;
        repo.recordToolCall(session.id, block.name, args, detail, "ok", dur);
        results.push({ tool: block.name, status: "ok", detail });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(detail ?? null),
        });
      } catch (err) {
        const dur = Date.now() - start;
        const msg = err instanceof Error ? err.message : String(err);
        repo.recordToolCall(
          session.id,
          block.name,
          args,
          { error: msg },
          "failed",
          dur,
        );
        results.push({ tool: block.name, status: "failed", detail: msg });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify({ error: msg }),
          is_error: true,
        });
        logger.error(`[agent ${session.id}] tool ${block.name} failed`, err);
      }
    }

    messages.push({ role: "user", content: toolResults });

    if (iter === MAX_ITERATIONS - 1) {
      truncated = true;
    }
  }

  const ok = !truncated && results.every((r) => r.status === "ok");
  const status: AgentRunResult["status"] = ok ? "executed" : "failed";
  repo.setSessionPlan(session.id, { messages });
  repo.setSessionStatus(session.id, status);

  if (!summary) {
    summary = truncated ? "(최대 반복 횟수에 도달했습니다.)" : "(요약 없음)";
  }

  return {
    session_id: session.id,
    status,
    tool_results: results,
    summary,
  };
}
