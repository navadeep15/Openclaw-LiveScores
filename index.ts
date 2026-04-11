import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { createCommandHandler } from "./src/commands.js";
import { CricbuzzProvider } from "./src/cricbuzz-provider.js";
import type { PluginApiLike } from "./src/openclaw.js";
import { createCricketNotifierService } from "./src/service.js";
import { CricketStateStore } from "./src/state.js";

export default definePluginEntry({
  id: "cricket-live-scores",
  name: "Cricket Live Scores",
  description: "IPL and cricket live score subscriptions for OpenClaw chats",
  register(api) {
    const pluginApi = api as unknown as PluginApiLike;
    const store = new CricketStateStore(pluginApi);
    const provider = new CricbuzzProvider(pluginApi);
    const handleCommand = createCommandHandler(pluginApi, store, provider);

    pluginApi.registerService(createCricketNotifierService(pluginApi, store, provider));

    pluginApi.registerCommand({
      name: "cricket",
      description: "List cricket matches and subscribe to live score pushes.",
      acceptsArgs: true,
      handler: async (ctx) => await handleCommand(ctx, "cricket")
    });

    pluginApi.registerCommand({
      name: "ipl",
      description: "List IPL matches and subscribe to live score pushes.",
      acceptsArgs: true,
      handler: async (ctx) => await handleCommand(ctx, "ipl")
    });
  }
});
