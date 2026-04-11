export interface CommandContextLike {
  args?: string;
  channel: string;
  from?: string;
  to?: string;
  senderId?: string;
  accountId?: string;
  messageThreadId?: string | number;
  gatewayClientScopes?: string[];
}

export interface CommandResponseLike {
  text: string;
}

export interface CommandDefinitionLike {
  name: string;
  description: string;
  acceptsArgs?: boolean;
  handler: (ctx: CommandContextLike) => Promise<CommandResponseLike> | CommandResponseLike;
}

export interface ServiceContextLike {
  stateDir: string;
}

export interface ServiceDefinitionLike {
  id: string;
  start: (ctx: ServiceContextLike) => Promise<void> | void;
  stop: () => Promise<void> | void;
}

export interface OutboundSendTextArgs {
  cfg: unknown;
  to: string;
  text: string;
  accountId?: string;
  threadId?: string | number;
}

export interface OutboundAdapterLike {
  sendText?: (args: OutboundSendTextArgs) => Promise<unknown>;
}

export interface PluginRuntimeLike {
  state: {
    resolveStateDir: () => string;
  };
  channel?: {
    outbound?: {
      loadAdapter: (channelId: string) => Promise<OutboundAdapterLike | null | undefined>;
    };
  };
  config: {
    loadConfig: () => unknown;
    writeConfigFile?: (cfg: unknown) => Promise<void> | void;
  };
}

export interface LoggerLike {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

export interface PluginApiLike {
  config: unknown;
  pluginConfig?: unknown;
  runtime: PluginRuntimeLike;
  logger: LoggerLike;
  registerCommand: (definition: CommandDefinitionLike) => void;
  registerService: (service: ServiceDefinitionLike) => void;
}
