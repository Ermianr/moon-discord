import { createClient } from "./client.js";
import type { Clock, GatewayConnect, RestHttp } from "./ports.js";
import type { ClientOptions } from "./types.js";

export type {
  Clock,
  GatewayConnect,
  GatewayConnection,
  GatewayConnectionHandlers,
  RestHttp,
  RestHttpRequest,
  RestHttpResponse,
} from "./ports.js";

export type TestClientPorts = {
  http: RestHttp;
  clock: Clock;
  gateway?: GatewayConnect;
};

export function createTestClient(options: ClientOptions, ports: TestClientPorts) {
  const wired: {
    http: RestHttp;
    clock: Clock;
    gatewayEnabled: true;
    connectGateway?: GatewayConnect;
  } = {
    http: ports.http,
    clock: ports.clock,
    gatewayEnabled: true,
  };
  if (ports.gateway !== undefined) {
    wired.connectGateway = ports.gateway;
  }
  return createClient(options, wired);
}
