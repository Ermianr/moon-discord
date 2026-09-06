import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigurationError, DiscordHttpError } from "moon-discord";
import { createTestClient } from "moon-discord/testing";
import type { RestHttp } from "moon-discord/testing";

function createClientWithHttp(http: RestHttp) {
  return createTestClient(
    { token: "bot-token" },
    {
      http,
      clock: {
        nowMs: () => 0,
        schedule: () => () => {},
      },
    },
  );
}

function parseMultipart(contentType: string, raw: string | Uint8Array | undefined) {
  assert.ok(raw instanceof Uint8Array);
  const match = /^multipart\/form-data; boundary=(.+)$/.exec(contentType);
  assert.ok(match);
  const boundary = match[1];
  assert.ok(boundary !== undefined);
  const text = Buffer.from(raw).toString("latin1");
  const delimiter = `--${boundary}`;
  const chunks = text.split(delimiter);
  assert.equal(chunks[0], "");
  const last = chunks[chunks.length - 1];
  assert.equal(last, "--\r\n");
  const parts = [];
  for (let index = 1; index < chunks.length - 1; index += 1) {
    const chunk = chunks[index];
    assert.ok(chunk !== undefined);
    assert.equal(chunk.startsWith("\r\n"), true);
    assert.equal(chunk.endsWith("\r\n"), true);
    const trimmed = chunk.slice(2, chunk.length - 2);
    const split = trimmed.indexOf("\r\n\r\n");
    assert.ok(split >= 0);
    const headerText = trimmed.slice(0, split);
    const body = Buffer.from(trimmed.slice(split + 4), "latin1");
    let name = "";
    let filename: string | undefined;
    let partContentType: string | undefined;
    const lines = headerText.split("\r\n");
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      assert.ok(line !== undefined);
      if (line.startsWith("Content-Disposition:")) {
        const nameMatch = /name="([^"]*)"/.exec(line);
        assert.ok(nameMatch);
        assert.ok(nameMatch[1] !== undefined);
        name = nameMatch[1];
        const filenameMatch = /filename="([^"]*)"/.exec(line);
        if (filenameMatch !== null && filenameMatch[1] !== undefined) {
          filename = filenameMatch[1];
        }
      } else if (line.startsWith("Content-Type:")) {
        partContentType = line.slice("Content-Type:".length).trim();
      }
    }
    const part: { name: string; filename?: string; contentType?: string; body: Buffer } = {
      name,
      body,
    };
    if (filename !== undefined) {
      part.filename = filename;
    }
    if (partContentType !== undefined) {
      part.contentType = partContentType;
    }
    parts.push(part);
  }
  return parts;
}

test("execute with files sends payload_json plus files[n] on the Rest HTTP adapter", async () => {
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: string | Uint8Array | undefined;
  const client = createClientWithHttp({
    request: async (request) => {
      capturedHeaders = request.headers;
      capturedBody = request.body;
      return {
        status: 200,
        headers: {},
        body: "{}",
      };
    },
  });
  await client.rest.execute({
    method: "POST",
    path: "/channels/1/messages",
    body: { content: "hello" },
    files: [{ filename: "a.txt", bytes: new Uint8Array([97]) }],
  });
  const parts = parseMultipart(capturedHeaders["Content-Type"] ?? "", capturedBody);
  assert.equal(parts.length, 2);
  assert.equal(parts[0]?.name, "payload_json");
  assert.equal(parts[0]?.contentType, "application/json");
  assert.equal(parts[0]?.body.toString("utf8"), '{"content":"hello"}');
  assert.equal(parts[1]?.name, "files[0]");
  assert.equal(parts[1]?.filename, "a.txt");
  assert.equal(parts[1]?.contentType, undefined);
  assert.deepEqual([...parts[1]!.body], [97]);
});

test("execute with two files names files[0] and files[1] in array order", async () => {
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: string | Uint8Array | undefined;
  const client = createClientWithHttp({
    request: async (request) => {
      capturedHeaders = request.headers;
      capturedBody = request.body;
      return { status: 200, headers: {}, body: "{}" };
    },
  });
  await client.rest.execute({
    method: "POST",
    path: "/channels/1/messages",
    body: { content: "hello" },
    files: [
      { filename: "a.txt", bytes: new Uint8Array([97]), contentType: "text/plain" },
      { filename: "b.bin", bytes: new Uint8Array([255, 0]) },
    ],
  });
  const parts = parseMultipart(capturedHeaders["Content-Type"] ?? "", capturedBody);
  assert.equal(parts.length, 3);
  assert.equal(parts[1]?.name, "files[0]");
  assert.equal(parts[1]?.contentType, "text/plain");
  assert.equal(parts[2]?.name, "files[1]");
  assert.equal(parts[2]?.filename, "b.bin");
  assert.equal(parts[2]?.contentType, undefined);
  assert.deepEqual([...parts[2]!.body], [255, 0]);
});

test("execute with missing filename or bytes throws ConfigurationError before HTTP", async () => {
  let httpCalls = 0;
  const client = createClientWithHttp({
    request: async () => {
      httpCalls += 1;
      return { status: 200, headers: {}, body: "{}" };
    },
  });
  await assert.rejects(
    () =>
      client.rest.execute({
        method: "POST",
        path: "/channels/1/messages",
        body: { content: "hello" },
        files: [{ filename: "", bytes: new Uint8Array([97]) }],
      }),
    (error: unknown) => error instanceof ConfigurationError,
  );
  const missingBytes = { filename: "a.txt", bytes: new Uint8Array([97]) };
  delete (missingBytes as { bytes?: Uint8Array }).bytes;
  await assert.rejects(
    () =>
      client.rest.execute({
        method: "POST",
        path: "/channels/1/messages",
        body: { content: "hello" },
        files: [missingBytes],
      }),
    (error: unknown) => error instanceof ConfigurationError,
  );
  assert.equal(httpCalls, 0);
});

test("execute does not reject oversized files locally; Discord size rejects stay DiscordHttpError", async () => {
  const tooBig = new Uint8Array(20 * 1024 * 1024 + 1);
  const client = createClientWithHttp({
    request: async (request) => {
      assert.ok(request.body instanceof Uint8Array);
      assert.ok(request.body.length > 20 * 1024 * 1024);
      return {
        status: 400,
        headers: {},
        body: JSON.stringify({ message: "Request entity too large", code: 40005 }),
      };
    },
  });
  await assert.rejects(
    () =>
      client.rest.execute({
        method: "POST",
        path: "/channels/1/messages",
        body: { content: "hello" },
        files: [{ filename: "big.bin", bytes: tooBig }],
      }),
    (error: unknown) => {
      assert.ok(error instanceof DiscordHttpError);
      assert.equal(error.status, 400);
      assert.equal(error.code, 40005);
      return true;
    },
  );
});

function exampleInboundMessageJson(): string {
  return JSON.stringify({
    reactions: [],
    attachments: [],
    tts: false,
    embeds: [],
    timestamp: "2017-07-11T17:27:07.299000+00:00",
    mention_everyone: false,
    id: "334385199974967042",
    pinned: false,
    edited_timestamp: null,
    author: {
      username: "Mason",
      discriminator: "9999",
      id: "53908099506183680",
      avatar: null,
    },
    mention_roles: [],
    content: "Supa Hot",
    channel_id: "290926798999357250",
    mentions: [],
    type: 0,
  });
}

test("createMessage with files strips files and sends payload_json plus files[n]", async () => {
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: string | Uint8Array | undefined;
  const client = createClientWithHttp({
    request: async (request) => {
      capturedHeaders = request.headers;
      capturedBody = request.body;
      return { status: 200, headers: {}, body: exampleInboundMessageJson() };
    },
  });
  const message = await client.rest.createMessage("290926798999357250", {
    content: "Hello, World!",
    files: [{ filename: "a.txt", bytes: new Uint8Array([97]) }],
  });
  const parts = parseMultipart(capturedHeaders["Content-Type"] ?? "", capturedBody);
  assert.equal(parts[0]?.body.toString("utf8"), '{"content":"Hello, World!"}');
  assert.equal(parts[1]?.name, "files[0]");
  assert.equal(parts[1]?.filename, "a.txt");
  assert.equal(message.id, "334385199974967042");
});

test("createMessage with omitted or empty files stays application/json", async () => {
  let capturedType = "";
  let capturedBody: string | Uint8Array | undefined;
  const client = createClientWithHttp({
    request: async (request) => {
      capturedType = request.headers["Content-Type"] ?? "";
      capturedBody = request.body;
      return { status: 200, headers: {}, body: exampleInboundMessageJson() };
    },
  });
  await client.rest.createMessage("1", { content: "hello", files: [] });
  assert.equal(capturedType, "application/json");
  assert.equal(capturedBody, '{"content":"hello"}');
});

test("createGuildSticker uses documented form names including file not files[n]", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: string | Uint8Array | undefined;
  const client = createClientWithHttp({
    request: async (request) => {
      capturedUrl = request.url;
      capturedHeaders = request.headers;
      capturedBody = request.body;
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          id: "749054660769218631",
          name: "Wave",
          description: "Wumpus waves hello",
          tags: "wumpus",
          type: 2,
          format_type: 1,
          extra: "drop-me",
        }),
      };
    },
  });
  const sticker = await client.rest.createGuildSticker("1", {
    name: "Wave",
    description: "Wumpus waves hello",
    tags: "wumpus",
    file: { filename: "wave.png", bytes: new Uint8Array([137, 80]), contentType: "image/png" },
  });
  assert.equal(capturedUrl, "https://discord.com/api/v10/guilds/1/stickers");
  const parts = parseMultipart(capturedHeaders["Content-Type"] ?? "", capturedBody);
  assert.equal(parts.length, 4);
  assert.equal(parts[0]?.name, "name");
  assert.equal(parts[0]?.body.toString("utf8"), "Wave");
  assert.equal(parts[1]?.name, "description");
  assert.equal(parts[1]?.body.toString("utf8"), "Wumpus waves hello");
  assert.equal(parts[2]?.name, "tags");
  assert.equal(parts[2]?.body.toString("utf8"), "wumpus");
  assert.equal(parts[3]?.name, "file");
  assert.equal(parts[3]?.filename, "wave.png");
  assert.equal(parts[3]?.contentType, "image/png");
  assert.deepEqual([...parts[3]!.body], [137, 80]);
  assert.equal(
    parts.some((part) => part.name.startsWith("files[") || part.name === "payload_json"),
    false,
  );
  assert.equal(sticker.id, "749054660769218631");
  assert.equal(sticker.name, "Wave");
  assert.equal(sticker.description, "Wumpus waves hello");
  assert.equal(sticker.tags, "wumpus");
  assert.equal(sticker.type, 2);
  assert.equal(sticker.format_type, 1);
  assert.equal("extra" in sticker, false);
});

test("createGuildSticker without the required file throws ConfigurationError before HTTP", async () => {
  let httpCalls = 0;
  const client = createClientWithHttp({
    request: async () => {
      httpCalls += 1;
      return { status: 200, headers: {}, body: "{}" };
    },
  });
  const body = {
    name: "Wave",
    description: "Wumpus waves hello",
    tags: "wumpus",
    file: { filename: "wave.png", bytes: new Uint8Array([1]) },
  };
  delete (body as { file?: unknown }).file;
  await assert.rejects(
    () => client.rest.createGuildSticker("1", body),
    (error: unknown) => error instanceof ConfigurationError,
  );
  assert.equal(httpCalls, 0);
});
