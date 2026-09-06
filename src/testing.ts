import { createClient } from "./client.js";
import type { Clock, RestHttp } from "./ports.js";
import type { ClientOptions } from "./types.js";

export type { Clock, RestHttp, RestHttpRequest, RestHttpResponse } from "./ports.js";

export type TestClientPorts = {
  http: RestHttp;
  clock: Clock;
};

export function createTestClient(options: ClientOptions, ports: TestClientPorts) {
  return createClient(options, {
    http: ports.http,
    clock: ports.clock,
    gatewayEnabled: true,
  });
}
