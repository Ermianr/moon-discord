import * as tls from "node:tls";
import { TransportError } from "./errors.js";
import {
  openGatewayConnection,
  type ByteSocket,
  type GatewayConn,
  type GatewayConnHandlers,
} from "./gateway-framing.js";

export type { GatewayConn, GatewayConnHandlers };

export function gatewayTlsConnectOptions(host: string, port: number): {
  host: string;
  port: number;
  servername: string;
  rejectUnauthorized: true;
} {
  return {
    host,
    port,
    servername: host,
    rejectUnauthorized: true,
  };
}

export function connectGatewayTransport(
  url: string,
  handlers: GatewayConnHandlers,
): Promise<GatewayConn> {
  const parsed = new URL(url);
  const host = parsed.host;
  let port = 443;
  const colon = host.lastIndexOf(":");
  if (colon >= 0) {
    const portText = host.slice(colon + 1);
    const parsedPort = Number(portText);
    if (parsedPort === parsedPort) {
      port = parsedPort;
    }
  }
  const options = gatewayTlsConnectOptions(parsed.hostname, port);
  const tlsSocket = tls.connect(options);
  const socket = wrapTlsSocket(tlsSocket);
  return new Promise((resolve, reject) => {
    let handshakeDone = false;
    tlsSocket.on("error", (err: Error) => {
      const error = new TransportError(err.message);
      if (!handshakeDone) {
        reject(error);
        return;
      }
      handlers.onError(error);
    });
    tlsSocket.on("secureConnect", () => {
      void (async () => {
        try {
          const conn = await openGatewayConnection(url, socket, handlers);
          handshakeDone = true;
          resolve(conn);
        } catch (error: unknown) {
          if (error instanceof Error && error.name === "TransportError") {
            reject(error);
            return;
          }
          const message = error instanceof Error ? error.message : "";
          reject(new TransportError(message));
        }
      })();
    });
  });
}

function wrapTlsSocket(tlsSocket: tls.TLSSocket): ByteSocket {
  return {
    write: (chunk) => {
      tlsSocket.write(chunk);
    },
    destroy: () => {
      tlsSocket.destroy();
    },
    setOnData: (handler) => {
      tlsSocket.on("data", (chunk: Buffer) => {
        const bytes = new Uint8Array(chunk.length);
        bytes.set(chunk);
        handler(bytes);
      });
    },
    setOnClose: (handler) => {
      tlsSocket.on("close", () => {
        handler();
      });
    },
  };
}
