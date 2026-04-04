import type { Client } from "discord.js";
import type { Event } from "../types/index.js";

export default {
  name: "ready",
  once: true,
  execute(client: Client<true>) {
    console.log(`Bot logged in as ${client.user.tag}`);
  },
} satisfies Event;
