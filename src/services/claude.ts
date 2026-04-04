import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

let client: Anthropic | null = null;

export function getClaudeClient(): Anthropic {
  if (!client) {
    if (!config.anthropic.apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }
    client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return client;
}
