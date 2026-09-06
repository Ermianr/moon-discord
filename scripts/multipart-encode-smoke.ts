import assert from "node:assert/strict";
import { createTestClient } from "../src/testing.js";
import type { RestHttp } from "../src/testing.js";

function parsePayloadJsonName(contentType: string, raw: string | Uint8Array | undefined): string[] {
  assert.ok(raw instanceof Uint8Array);
  const match = /^multipart\/form-data; boundary=(.+)$/.exec(contentType);
  assert.ok(match);
  const boundary = match[1];
  assert.ok(boundary !== undefined);
  const text = Buffer.from(raw).toString("latin1");
  const names: string[] = [];
  const chunks = text.split(`--${boundary}`);
  for (let index = 1; index < chunks.length - 1; index += 1) {
    const chunk = chunks[index];
    assert.ok(chunk !== undefined);
    const nameMatch = /name="([^"]*)"/.exec(chunk);
    assert.ok(nameMatch);
    assert.ok(nameMatch[1] !== undefined);
    names.push(nameMatch[1]);
  }
  return names;
}

let capturedHeaders: Record<string, string> = {};
let capturedBody: string | Uint8Array | undefined;
const http: RestHttp = {
  request: async (request) => {
    capturedHeaders = request.headers;
    capturedBody = request.body;
    return { status: 200, headers: {}, body: "{}" };
  },
};

const client = createTestClient(
  { token: "bot-token" },
  {
    http,
    clock: {
      nowMs: () => 0,
      schedule: () => () => {},
    },
  },
);

await client.rest.execute({
  method: "POST",
  path: "/channels/1/messages",
  body: { content: "hello" },
  files: [{ filename: "a.txt", bytes: new Uint8Array([97]) }],
});

const names = parsePayloadJsonName(capturedHeaders["Content-Type"] ?? "", capturedBody);
assert.deepEqual(names, ["payload_json", "files[0]"]);
console.log("multipart encode smoke ok");
