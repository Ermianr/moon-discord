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

export type GatewayConnection = {
  sendText: (text: string) => void;
  close: (code: number) => void;
};

export type GatewayConnectionHandlers = {
  onText: (text: string) => void;
  onClose: (code: number | undefined) => void;
  onError: (error: Error) => void;
};

export type GatewayConnect = (
  url: string,
  handlers: GatewayConnectionHandlers,
) => Promise<GatewayConnection>;

export type Ports = {
  http: RestHttp;
  clock: Clock;
  gatewayEnabled: boolean;
  connectGateway?: GatewayConnect;
};
