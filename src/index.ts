import { createClient } from "./client.js";
import type {
  PresenceUpdate,
  RequestChannelInfo,
  RequestGuildMembers,
  RequestSoundboardSounds,
  VoiceStateUpdate,
} from "./decode/gateway-send.js";
import { fetchHttp } from "./fetch-http.js";
import { connectGatewayTransport } from "./gateway-transport.js";
import type { GatewayConnect } from "./ports.js";
import { systemClock } from "./system-clock.js";
import type { ClientOptions } from "./types.js";

const connectGateway: GatewayConnect = (url, handlers) => {
  return connectGatewayTransport(url, handlers);
};

export class Client {
  readonly rest: ReturnType<typeof createClient>["rest"];
  readonly closed: Promise<void>;
  #core: ReturnType<typeof createClient>;

  constructor(options: ClientOptions) {
    const core = createClient(options, {
      http: fetchHttp(),
      clock: systemClock(),
      gatewayEnabled: true,
      connectGateway,
    });
    this.#core = core;
    this.rest = core.rest;
    this.closed = core.closed;
  }

  on(dispatch: string, handler: (payload: unknown) => void): () => void {
    return this.#core.on(dispatch, handler);
  }

  onUnknownDispatch(handler: (payload: unknown) => void): () => void {
    return this.#core.onUnknownDispatch(handler);
  }

  connect(options?: { signal?: AbortSignal }): Promise<void> {
    return this.#core.connect(options);
  }

  disconnect(): Promise<void> {
    return this.#core.disconnect();
  }

  updatePresence(presence: PresenceUpdate, options?: { signal?: AbortSignal }): Promise<void> {
    return this.#core.updatePresence(presence, options);
  }

  updateVoiceState(voiceState: VoiceStateUpdate, options?: { signal?: AbortSignal }): Promise<void> {
    return this.#core.updateVoiceState(voiceState, options);
  }

  requestGuildMembers(query: RequestGuildMembers, options?: { signal?: AbortSignal }): Promise<void> {
    return this.#core.requestGuildMembers(query, options);
  }

  requestSoundboardSounds(query: RequestSoundboardSounds, options?: { signal?: AbortSignal }): Promise<void> {
    return this.#core.requestSoundboardSounds(query, options);
  }

  requestChannelInfo(query: RequestChannelInfo, options?: { signal?: AbortSignal }): Promise<void> {
    return this.#core.requestChannelInfo(query, options);
  }
}

export {
  CancelledError,
  ConfigurationError,
  DecodeError,
  DiscordHttpError,
  GATEWAY_SEND_QUEUE,
  GATEWAY_SESSION_WAIT_MS,
  GatewayFatalError,
  GatewayIntent,
  HTTP_5XX_RETRY_MS,
  MoonDiscordError,
  REST_MAX_WAIT_MS,
  SaturatedError,
  TransportError,
  type ClientOptions,
} from "./public-api.js";
