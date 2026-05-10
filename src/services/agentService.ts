import type Anthropic from "@anthropic-ai/sdk";
import { getClaudeClient } from "./claude.js";
import * as registry from "./agent/toolRegistry.js";
import * as repo from "../db/repositories/agentRepository.js";
import type { BotClient } from "../client.js";
import { logger } from "../utils/logger.js";

const MODEL = "claude-opus-4-7";
const MAX_PLAN_STEPS = 5;

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

  const plan = await planWithLLM(inputText);
  repo.setSessionPlan(session.id, plan);

  const results: AgentRunResult["tool_results"] = [];
  for (const step of plan.steps.slice(0, MAX_PLAN_STEPS)) {
    const tool = registry.findTool(step.tool);
    if (!tool) {
      results.push({
        tool: step.tool,
        status: "failed",
        detail: `unknown tool`,
      });
      continue;
    }
    const start = Date.now();
    try {
      const detail = await tool.handler(client, step.args);
      const dur = Date.now() - start;
      repo.recordToolCall(session.id, step.tool, step.args, detail, "ok", dur);
      results.push({ tool: step.tool, status: "ok", detail });
    } catch (err) {
      const dur = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      repo.recordToolCall(
        session.id,
        step.tool,
        step.args,
        { error: msg },
        "failed",
        dur,
      );
      results.push({ tool: step.tool, status: "failed", detail: msg });
      logger.error(`[agent ${session.id}] tool ${step.tool} failed`, err);
    }
  }

  const ok = results.every((r) => r.status === "ok");
  const status: AgentRunResult["status"] = ok ? "executed" : "failed";
  repo.setSessionStatus(session.id, status);

  return {
    session_id: session.id,
    status,
    tool_results: results,
    summary: plan.summary,
  };
}

interface AgentPlan {
  steps: { tool: string; args: Record<string, unknown> }[];
  summary: string;
}

async function planWithLLM(inputText: string): Promise<AgentPlan> {
  const claude = getClaudeClient();
  const toolDefs: Anthropic.Tool[] = registry.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }));

  const res = await claude.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: toolDefs,
    messages: [{ role: "user", content: inputText }],
  });

  const steps: AgentPlan["steps"] = [];
  let summary = "";
  for (const block of res.content) {
    if (block.type === "tool_use") {
      steps.push({
        tool: block.name,
        args: (block.input ?? {}) as Record<string, unknown>,
      });
    } else if (block.type === "text") {
      summary += block.text;
    }
  }
  return { steps, summary: summary.trim() || "(요약 없음)" };
}
