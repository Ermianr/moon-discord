import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { TransportError } from "../src/errors.js";
import {
  openGatewayConnection,
  type ByteSocket,
  type GatewayConnHandlers,
} from "../src/gateway-framing.js";

type LinkedEnd = {
  peer: LinkedEnd | undefined;
  dataHandler: ((chunk: Uint8Array) => void) | undefined;
  closeHandler: (() => void) | undefined;
  queued: Uint8Array[];
  closed: boolean;
};

function createLinkedByteSockets(): { client: ByteSocket; server: ByteSocket } {
  const clientEnd: LinkedEnd = {
    peer: undefined,
    dataHandler: undefined,
    closeHandler: undefined,
    queued: [],
    closed: false,
  };
  const serverEnd: LinkedEnd = {
    peer: undefined,
    dataHandler: undefined,
    closeHandler: undefined,
    queued: [],
    closed: false,
  };
  clientEnd.peer = serverEnd;
  serverEnd.peer = clientEnd;
  return { client: byteSocket(clientEnd), server: byteSocket(serverEnd) };
}

function byteSocket(end: LinkedEnd): ByteSocket {
  return {
    write: (chunk) => {
      const peer = end.peer;
      if (peer === undefined || peer.closed) {
        return;
      }
      const copy = new Uint8Array(chunk.length);
      copy.set(chunk);
      if (peer.dataHandler === undefined) {
        peer.queued.push(copy);
        return;
      }
      peer.dataHandler(copy);
    },
    destroy: () => {
      if (end.closed) {
        return;
      }
      end.closed = true;
      const peer = end.peer;
      if (peer !== undefined && !peer.closed) {
        peer.closed = true;
        const closeHandler = peer.closeHandler;
        if (closeHandler !== undefined) {
          closeHandler();
        }
      }
    },
    setOnData: (handler) => {
      end.dataHandler = handler;
      while (end.queued.length > 0) {
        const next = end.queued.shift();
        if (next !== undefined) {
          handler(next);
        }
      }
    },
    setOnClose: (handler) => {
      end.closeHandler = handler;
    },
  };
}

function silentHandlers(
  extras?: Partial<GatewayConnHandlers>,
): GatewayConnHandlers {
  return {
    onText: extras?.onText ?? (() => {}),
    onClose: extras?.onClose ?? (() => {}),
    onError: extras?.onError ?? (() => {}),
  };
}

function concatChunks(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (chunk !== undefined) {
      total += chunk.length;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    if (chunk !== undefined) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
  }
  return out;
}

function copyUint8(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

function waitForHttpRequest(server: ByteSocket): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = [];
    server.setOnData((chunk) => {
      chunks.push(chunk);
      const text = new TextDecoder().decode(concatChunks(chunks));
      if (text.includes("\r\n\r\n")) {
        resolve(text);
      }
    });
  });
}

function headerValue(request: string, name: string): string | undefined {
  const lines = request.split("\r\n");
  const prefix = `${name.toLowerCase()}:`;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    if (line.toLowerCase().startsWith(prefix)) {
      return line.slice(line.indexOf(":") + 1).trim();
    }
  }
  return undefined;
}

function acceptForKey(key: string): string {
  return createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

function completeUpgrade(server: ByteSocket, request: string): void {
  const key = headerValue(request, "Sec-WebSocket-Key");
  assert.notEqual(key, undefined);
  const accept = acceptForKey(key ?? "");
  const body = new TextEncoder().encode(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  server.write(body);
}

test("connect Upgrade GET uses v=10 encoding=json and omits compress", async () => {
  const { client, server } = createLinkedByteSockets();
  const requestPromise = waitForHttpRequest(server);
  void openGatewayConnection("wss://gateway.discord.gg/", client, silentHandlers());
  const request = await requestPromise;
  const requestLine = request.split("\r\n")[0];
  assert.equal(requestLine, "GET /?v=10&encoding=json HTTP/1.1");
  assert.equal(request.includes("compress="), false);
  assert.equal(headerValue(request, "Host"), "gateway.discord.gg");
  assert.equal(headerValue(request, "Upgrade")?.toLowerCase(), "websocket");
  assert.equal(headerValue(request, "Sec-WebSocket-Version"), "13");
});

test("connect strips compress and pins v=10 encoding=json on an existing query", async () => {
  const { client, server } = createLinkedByteSockets();
  const requestPromise = waitForHttpRequest(server);
  void openGatewayConnection(
    "wss://gateway.discord.gg/?v=9&encoding=etf&compress=zlib-stream",
    client,
    silentHandlers(),
  );
  const request = await requestPromise;
  const requestLine = request.split("\r\n")[0];
  assert.equal(requestLine, "GET /?v=10&encoding=json HTTP/1.1");
  assert.equal(request.includes("compress="), false);
});

test("RFC 6455 sample Sec-WebSocket-Accept is s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", () => {
  assert.equal(acceptForKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("Upgrade 101 with matching Sec-WebSocket-Accept opens the connection", async () => {
  const { client, server } = createLinkedByteSockets();
  const requestPromise = waitForHttpRequest(server);
  const opened = openGatewayConnection(
    "wss://gateway.discord.gg/",
    client,
    silentHandlers(),
  );
  completeUpgrade(server, await requestPromise);
  const conn = await opened;
  assert.equal(typeof conn.sendText, "function");
  assert.equal(typeof conn.close, "function");
});

test("Upgrade with a wrong Sec-WebSocket-Accept is a TransportError", async () => {
  const { client, server } = createLinkedByteSockets();
  const requestPromise = waitForHttpRequest(server);
  const opened = openGatewayConnection(
    "wss://gateway.discord.gg/",
    client,
    silentHandlers(),
  );
  await requestPromise;
  server.write(
    new TextEncoder().encode(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n",
    ),
  );
  await assert.rejects(opened, (error: unknown) => {
    assert.ok(error instanceof TransportError);
    assert.equal(error.name, "TransportError");
    return true;
  });
});

test("Upgrade that is not 101 is a TransportError", async () => {
  const { client, server } = createLinkedByteSockets();
  const requestPromise = waitForHttpRequest(server);
  const opened = openGatewayConnection(
    "wss://gateway.discord.gg/",
    client,
    silentHandlers(),
  );
  await requestPromise;
  server.write(new TextEncoder().encode("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n"));
  await assert.rejects(opened, (error: unknown) => error instanceof TransportError);
});

async function openAfterUpgrade(handlers?: Partial<GatewayConnHandlers>): Promise<{
  conn: Awaited<ReturnType<typeof openGatewayConnection>>;
  server: ByteSocket;
}> {
  const { client, server } = createLinkedByteSockets();
  const requestPromise = waitForHttpRequest(server);
  const opened = openGatewayConnection(
    "wss://gateway.discord.gg/",
    client,
    silentHandlers(handlers),
  );
  completeUpgrade(server, await requestPromise);
  return { conn: await opened, server };
}

function collectFrames(server: ByteSocket): {
  nextFrame: () => Promise<Uint8Array>;
  queuedCount: () => number;
} {
  const pending: ((frame: Uint8Array) => void)[] = [];
  const ready: Uint8Array[] = [];
  let buffer = new Uint8Array(0);
  server.setOnData((chunk) => {
    buffer = concatChunks([buffer, copyUint8(chunk)]);
    for (;;) {
      const parsed = takeFrame(buffer);
      if (parsed === undefined) {
        return;
      }
      buffer = parsed.rest;
      const waiter = pending.shift();
      if (waiter !== undefined) {
        waiter(parsed.frame);
      } else {
        ready.push(parsed.frame);
      }
    }
  });
  return {
    queuedCount: () => ready.length,
    nextFrame: () =>
      new Promise((resolve) => {
        const queued = ready.shift();
        if (queued !== undefined) {
          resolve(queued);
          return;
        }
        pending.push(resolve);
      }),
  };
}

function takeFrame(buffer: Uint8Array): { frame: Uint8Array<ArrayBuffer>; rest: Uint8Array<ArrayBuffer> } | undefined {
  if (buffer.length < 2) {
    return undefined;
  }
  const b1 = buffer[1];
  if (b1 === undefined) {
    return undefined;
  }
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buffer.length < 4) {
      return undefined;
    }
    const hi = buffer[2];
    const lo = buffer[3];
    if (hi === undefined || lo === undefined) {
      return undefined;
    }
    len = (hi << 8) | lo;
    offset = 4;
  } else if (len === 127) {
    if (buffer.length < 10) {
      return undefined;
    }
    len = 0;
    for (let i = 2; i < 10; i += 1) {
      const b = buffer[i];
      if (b === undefined) {
        return undefined;
      }
      len = len * 256 + b;
    }
    offset = 10;
  }
  const maskLen = masked ? 4 : 0;
  const total = offset + maskLen + len;
  if (buffer.length < total) {
    return undefined;
  }
  return { frame: copyUint8(buffer.subarray(0, total)), rest: copyUint8(buffer.subarray(total)) };
}

function decodeMaskedFrame(frame: Uint8Array): { opcode: number; mask: Uint8Array; payload: Uint8Array } {
  const b0 = frame[0];
  const b1 = frame[1];
  assert.notEqual(b0, undefined);
  assert.notEqual(b1, undefined);
  const opcode = (b0 ?? 0) & 0x0f;
  assert.equal((b1 ?? 0) & 0x80, 0x80);
  let len = (b1 ?? 0) & 0x7f;
  let offset = 2;
  if (len === 126) {
    const hi = frame[2];
    const lo = frame[3];
    assert.notEqual(hi, undefined);
    assert.notEqual(lo, undefined);
    len = ((hi ?? 0) << 8) | (lo ?? 0);
    offset = 4;
  }
  const mask = frame.subarray(offset, offset + 4);
  const masked = frame.subarray(offset + 4, offset + 4 + len);
  const payload = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    const byte = masked[i];
    const maskByte = mask[i % 4];
    payload[i] = (byte ?? 0) ^ (maskByte ?? 0);
  }
  return { opcode, mask, payload };
}

function serverTextFrame(text: string): Uint8Array {
  return serverFrame(0x81, new TextEncoder().encode(text));
}

function serverFrame(firstByte: number, payload: Uint8Array): Uint8Array {
  const len = payload.length;
  let header: Uint8Array;
  if (len < 126) {
    header = new Uint8Array(2);
    header[0] = firstByte;
    header[1] = len;
  } else if (len <= 0xffff) {
    header = new Uint8Array(4);
    header[0] = firstByte;
    header[1] = 126;
    header[2] = (len >> 8) & 0xff;
    header[3] = len & 0xff;
  } else {
    throw new Error("test payload too large");
  }
  const out = new Uint8Array(header.length + payload.length);
  out.set(header, 0);
  out.set(payload, header.length);
  return out;
}

test("sendText writes a masked text frame with a fresh mask each time", async () => {
  const { conn, server } = await openAfterUpgrade();
  const { nextFrame } = collectFrames(server);
  conn.sendText('{"op":1,"d":null}');
  conn.sendText('{"op":1,"d":null}');
  const first = decodeMaskedFrame(await nextFrame());
  const second = decodeMaskedFrame(await nextFrame());
  assert.equal(first.opcode, 1);
  assert.equal(second.opcode, 1);
  assert.equal(new TextDecoder().decode(first.payload), '{"op":1,"d":null}');
  assert.equal(new TextDecoder().decode(second.payload), '{"op":1,"d":null}');
  assert.equal(first.mask.length, 4);
  assert.equal(second.mask.length, 4);
  assert.notDeepEqual(Array.from(first.mask), Array.from(second.mask));
});

test("inbound unmasked text frames become GatewayConn onText", async () => {
  let received = "";
  const { server } = await openAfterUpgrade({
    onText: (text) => {
      received = text;
    },
  });
  server.write(serverTextFrame('{"op":10,"d":{"heartbeat_interval":45000}}'));
  await Promise.resolve();
  assert.equal(received, '{"op":10,"d":{"heartbeat_interval":45000}}');
});

test("inbound ping is answered with a masked pong of the same payload", async () => {
  const { server } = await openAfterUpgrade();
  const { nextFrame } = collectFrames(server);
  server.write(serverFrame(0x89, new TextEncoder().encode("ping-body")));
  const pong = decodeMaskedFrame(await nextFrame());
  assert.equal(pong.opcode, 10);
  assert.equal(new TextDecoder().decode(pong.payload), "ping-body");
});

test("close sends a masked close frame and inbound close notifies the handler", async () => {
  let closedCode: number | undefined;
  const { conn, server } = await openAfterUpgrade({
    onClose: (code) => {
      closedCode = code;
    },
  });
  const { nextFrame, queuedCount } = collectFrames(server);
  conn.close(1000);
  const outbound = decodeMaskedFrame(await nextFrame());
  assert.equal(outbound.opcode, 8);
  assert.equal(outbound.payload.length, 2);
  assert.equal((outbound.payload[0] ?? 0) * 256 + (outbound.payload[1] ?? 0), 1000);
  conn.sendText('{"op":1,"d":null}');
  await Promise.resolve();
  assert.equal(queuedCount(), 0);
  server.write(serverFrame(0x88, new Uint8Array([0x03, 0xe8])));
  await Promise.resolve();
  assert.equal(closedCode, 1000);
});

test("64-bit payload length with a high word set is rejected without bigint", async () => {
  let error: unknown;
  const { server } = await openAfterUpgrade({
    onError: (err) => {
      error = err;
    },
  });
  server.write(new Uint8Array([0x81, 0x7f, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]));
  await Promise.resolve();
  assert.ok(error instanceof TransportError);
});

test("inbound close is answered with a masked close frame", async () => {
  let closedCode: number | undefined;
  const { server } = await openAfterUpgrade({
    onClose: (code) => {
      closedCode = code;
    },
  });
  const { nextFrame } = collectFrames(server);
  server.write(serverFrame(0x88, new Uint8Array([0x03, 0xe8])));
  const reply = decodeMaskedFrame(await nextFrame());
  assert.equal(reply.opcode, 8);
  assert.equal((reply.payload[0] ?? 0) * 256 + (reply.payload[1] ?? 0), 1000);
  assert.equal(closedCode, 1000);
});
