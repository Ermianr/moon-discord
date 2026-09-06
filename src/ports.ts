export type RestHttpRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
};

export type RestHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array;
};

export type RestHttp = {
  request: (request: RestHttpRequest) => Promise<RestHttpResponse>;
};

export type Clock = {
  nowMs: () => number;
  schedule: (delayMs: number, callback: () => void) => () => void;
};

export type Ports = {
  http: RestHttp;
  clock: Clock;
  gatewayEnabled: boolean;
};
