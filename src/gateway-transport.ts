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
  const port = parsed.port === "" ? 443 : Number(parsed.port);
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
      openGatewayConnection(url, socket, handlers).then(
        (conn) => {
          handshakeDone = true;
          resolve(conn);
        },
        (error: Error) => {
          reject(error instanceof TransportError ? error : new TransportError(error.message));
        },
      );
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
