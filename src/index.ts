import { Client as ClientImpl } from "./client.js";
import { fetchHttp } from "./fetch-http.js";
import "./gateway-transport.js";
import { systemClock } from "./system-clock.js";
import type { ClientOptions } from "./types.js";

export class Client extends ClientImpl {
  constructor(options: ClientOptions) {
    super(options, {
      http: fetchHttp(),
      clock: systemClock(),
      gatewayEnabled: true,
    });
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
