import { createHash, randomBytes } from "node:crypto";
import { TransportError } from "./errors.js";

export type ByteSocket = {
  write: (chunk: Uint8Array) => void;
  destroy: () => void;
  setOnData: (handler: (chunk: Uint8Array) => void) => void;
  setOnClose: (handler: () => void) => void;
};

export type GatewayConn = {
  sendText: (text: string) => void;
  close: (code: number) => void;
};

export type GatewayConnHandlers = {
  onText: (text: string) => void;
  onClose: (code: number | undefined) => void;
  onError: (error: Error) => void;
};

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_PAYLOAD = 16 * 1024 * 1024;
const OP_TEXT = 1;
const OP_CLOSE = 8;
const OP_PING = 9;
const OP_PONG = 10;

export function openGatewayConnection(
  url: string,
  socket: ByteSocket,
  handlers: GatewayConnHandlers,
): Promise<GatewayConn> {
  const target = gatewayTarget(url);
  const key = randomBytes(16).toString("base64");
  const expectedAccept = secWebSocketAccept(key);
  let buffer = new Uint8Array(0);
  let opened = false;
  let closed = false;
  let closeSent = false;
  let failed = false;

  const fail = (error: TransportError): void => {
    if (failed) {
      return;
    }
    failed = true;
    handlers.onError(error);
    socket.destroy();
  };

  const sendFrame = (opcode: number, payload: Uint8Array): void => {
    if (failed || closed) {
      return;
    }
    if (closeSent && opcode !== OP_CLOSE) {
      return;
    }
    socket.write(encodeMaskedFrame(opcode, payload));
  };

  const conn: GatewayConn = {
    sendText: (text) => {
      sendFrame(OP_TEXT, encodeUtf8(text));
    },
    close: (code) => {
      if (closeSent || failed) {
        return;
      }
      closeSent = true;
      sendFrame(OP_CLOSE, closePayload(code));
    },
  };

  const handleCloseFrame = (payload: Uint8Array): void => {
    if (closed) {
      return;
    }
    let code: number | undefined;
    if (payload.length >= 2) {
      const hi = payload[0];
      const lo = payload[1];
      if (hi !== undefined && lo !== undefined) {
        code = hi * 256 + lo;
      }
    }
    if (!closeSent) {
      closeSent = true;
      const reply = payload.length >= 2 ? copyBytesRange(payload, 0, 2) : closePayload(1000);
      sendFrame(OP_CLOSE, reply);
    }
    closed = true;
    handlers.onClose(code);
    socket.destroy();
  };

  const dispatchFrame = (opcode: number, payload: Uint8Array): void => {
    if (opcode === OP_PING) {
      sendFrame(OP_PONG, payload);
      return;
    }
    if (opcode === OP_PONG) {
      return;
    }
    if (opcode === OP_CLOSE) {
      handleCloseFrame(payload);
      return;
    }
    if (opcode === OP_TEXT) {
      try {
        handlers.onText(new TextDecoder().decode(payload));
      } catch {
        fail(new TransportError("Gateway text frame is not UTF-8"));
      }
      return;
    }
    fail(new TransportError(`Gateway frame opcode ${String(opcode)} is not supported`));
  };

  const parseFrames = (): void => {
    while (!failed && !closed) {
      if (buffer.length < 2) {
        return;
      }
      const b0 = buffer[0];
      const b1 = buffer[1];
      if (b0 === undefined || b1 === undefined) {
        return;
      }
      const rsv = b0 & 0x70;
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      const len7 = b1 & 0x7f;
      let headerLen = 2;
      let payloadLen = 0;
      if (len7 === 127) {
        if (buffer.length < 10) {
          return;
        }
        const high = readUint32(buffer, 2);
        const low = readUint32(buffer, 6);
        headerLen = 10;
        if (high !== 0 || low > MAX_PAYLOAD) {
          fail(new TransportError("Gateway frame exceeds size cap"));
          return;
        }
        payloadLen = low;
      } else if (len7 === 126) {
        if (buffer.length < 4) {
          return;
        }
        const hi = buffer[2];
        const lo = buffer[3];
        if (hi === undefined || lo === undefined) {
          return;
        }
        payloadLen = hi * 256 + lo;
        headerLen = 4;
        if (payloadLen > MAX_PAYLOAD) {
          fail(new TransportError("Gateway frame exceeds size cap"));
          return;
        }
      } else {
        payloadLen = len7;
      }
      if (rsv !== 0) {
        fail(new TransportError("Gateway frame RSV bits must be zero"));
        return;
      }
      if (!fin) {
        fail(new TransportError("Gateway fragmented frames are not supported"));
        return;
      }
      if (masked) {
        fail(new TransportError("Gateway server frames must not be masked"));
        return;
      }
      const total = headerLen + payloadLen;
      if (buffer.length < total) {
        return;
      }
      const payload = new Uint8Array(payloadLen);
      payload.set(buffer.subarray(headerLen, total));
      buffer = copyBytes(buffer, total);
      dispatchFrame(opcode, payload);
    }
  };

  return new Promise((resolve, reject) => {
    socket.setOnData((chunk) => {
      if (failed || closed) {
        return;
      }
      buffer = concatBytes(buffer, chunk);
      if (!opened) {
        const headerEnd = findHeaderEnd(buffer);
        if (headerEnd < 0) {
          return;
        }
        const headerText = new TextDecoder().decode(buffer.subarray(0, headerEnd));
        buffer = copyBytes(buffer, headerEnd);
        const failure = upgradeFailure(headerText, expectedAccept);
        if (failure !== undefined) {
          failed = true;
          socket.destroy();
          reject(failure);
          return;
        }
        opened = true;
        resolve(conn);
      }
      parseFrames();
    });
    socket.setOnClose(() => {
      if (!opened) {
        reject(new TransportError("Gateway socket closed before Upgrade"));
        return;
      }
      if (!closed && !failed) {
        closed = true;
        handlers.onClose(undefined);
      }
    });
    socket.write(encodeUtf8(upgradeRequest(target, key)));
  });
}

type GatewayTarget = {
  hostHeader: string;
  requestPath: string;
};

function gatewayTarget(url: string): GatewayTarget {
  const parsed = new URL(url);
  parsed.searchParams.delete("compress");
  parsed.searchParams.set("v", "10");
  parsed.searchParams.set("encoding", "json");
  const pathname = parsed.pathname === "" ? "/" : parsed.pathname;
  return {
    hostHeader: parsed.hostname,
    requestPath: `${pathname}${parsed.search}`,
  };
}

function upgradeRequest(target: GatewayTarget, key: string): string {
  return (
    `GET ${target.requestPath} HTTP/1.1\r\n` +
    `Host: ${target.hostHeader}\r\n` +
    `Upgrade: websocket\r\n` +
    `Connection: Upgrade\r\n` +
    `Sec-WebSocket-Key: ${key}\r\n` +
    `Sec-WebSocket-Version: 13\r\n` +
    `\r\n`
  );
}

function secWebSocketAccept(key: string): string {
  return createHash("sha1").update(`${key}${WEBSOCKET_GUID}`).digest("base64");
}

function upgradeFailure(headerText: string, expectedAccept: string): TransportError | undefined {
  const lines = headerText.split("\r\n");
  const statusLine = lines[0];
  if (statusLine === undefined) {
    return new TransportError("Gateway Upgrade response is empty");
  }
  const status = httpStatus(statusLine);
  if (status !== 101) {
    return new TransportError(`Gateway Upgrade expected 101, got ${String(status)}`);
  }
  const accept = headerField(lines, "sec-websocket-accept");
  if (accept === undefined || accept !== expectedAccept) {
    return new TransportError("Gateway Upgrade Sec-WebSocket-Accept mismatch");
  }
  return undefined;
}

function httpStatus(statusLine: string): number {
  const parts = statusLine.split(" ");
  const token = parts[1];
  if (token === undefined) {
    return 0;
  }
  return Number(token);
}

function headerField(lines: string[], name: string): string | undefined {
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || line === "") {
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 0) {
      continue;
    }
    if (line.slice(0, colon).trim().toLowerCase() === name) {
      return line.slice(colon + 1).trim();
    }
  }
  return undefined;
}

function findHeaderEnd(buffer: Uint8Array): number {
  for (let i = 0; i + 3 < buffer.length; i += 1) {
    const b0 = buffer[i];
    const b1 = buffer[i + 1];
    const b2 = buffer[i + 2];
    const b3 = buffer[i + 3];
    if (b0 === 13 && b1 === 10 && b2 === 13 && b3 === 10) {
      return i + 4;
    }
  }
  return -1;
}

function encodeMaskedFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const maskBytes = randomBytes(4);
  const mask = new Uint8Array(4);
  mask.set(maskBytes);
  const len = payload.length;
  let headerLen = 6;
  if (len >= 126 && len <= 0xffff) {
    headerLen = 8;
  } else if (len > 0xffff) {
    headerLen = 14;
  }
  const out = new Uint8Array(headerLen + len);
  out[0] = 0x80 | opcode;
  let offset = 2;
  if (len < 126) {
    out[1] = 0x80 | len;
  } else if (len <= 0xffff) {
    out[1] = 0x80 | 126;
    out[2] = Math.floor(len / 256) & 0xff;
    out[3] = len & 0xff;
    offset = 4;
  } else {
    out[1] = 0x80 | 127;
    writeUint32(out, 2, 0);
    writeUint32(out, 6, len);
    offset = 10;
  }
  out.set(mask, offset);
  const payloadOffset = offset + 4;
  for (let i = 0; i < len; i += 1) {
    const byte = payload[i];
    const maskByte = mask[i % 4];
    if (byte === undefined || maskByte === undefined) {
      continue;
    }
    out[payloadOffset + i] = byte ^ maskByte;
  }
  return out;
}

function closePayload(code: number): Uint8Array {
  const out = new Uint8Array(2);
  out[0] = Math.floor(code / 256) & 0xff;
  out[1] = code & 0xff;
  return out;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) {
    return 0;
  }
  return b0 * 16777216 + b1 * 65536 + b2 * 256 + b3;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = Math.floor(value / 16777216) & 0xff;
  bytes[offset + 1] = Math.floor(value / 65536) & 0xff;
  bytes[offset + 2] = Math.floor(value / 256) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

function copyBytes(bytes: Uint8Array, start: number): Uint8Array<ArrayBuffer> {
  return copyBytesRange(bytes, start, bytes.length);
}

function copyBytesRange(bytes: Uint8Array, start: number, end: number): Uint8Array<ArrayBuffer> {
  const slice = bytes.subarray(start, end);
  const out = new Uint8Array(slice.length);
  out.set(slice);
  return out;
}

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
