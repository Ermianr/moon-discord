import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { decodeMessage, decodeMessageList, decodeReady } from "../src/decode/index.js";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function readFixture(name: string): unknown {
  const text = fs.readFileSync(path.join(repoRoot, "fixtures/decode", name), "utf8");
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

function assertHasExtraKeys(value: unknown, extras: string[]): void {
  assert.equal(typeof value === "object" && value !== null && !Array.isArray(value), true);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return;
  }
  for (let i = 0; i < extras.length; i += 1) {
    const key = extras[i];
    if (key === undefined) {
      continue;
    }
    assert.equal(key in value, true, `fixture must include extra key ${key}`);
  }
}

test("guild MESSAGE_CREATE fixture copy-decodes and drops extra keys", () => {
  const payload = readFixture("guild-message-create.json");
  assertHasExtraKeys(payload, ["reactions", "flags", "nonce", "referenced_message"]);
  const message = decodeMessage(payload);
  assert.equal(message.id, "334385199974967042");
  assert.equal(message.channel_id, "290926798999357250");
  assert.equal(message.content, "Supa Hot");
  assert.equal(message.author.id, "53908099506183680");
  assert.equal("reactions" in message, false);
  assert.equal("flags" in message, false);
  assert.equal("nonce" in message, false);
  assert.equal("referenced_message" in message, false);
});

test("large READY fixture copy-decodes owned fields and drops extras", () => {
  const payload = readFixture("ready.json");
  assertHasExtraKeys(payload, ["v", "heartbeat_interval", "trace", "application"]);
  const ready = decodeReady(payload);
  assert.equal(ready.session_id, "abcde12345");
  assert.equal(ready.resume_gateway_url, "wss://gateway-us-east1-b.discord.gg");
  assert.equal(ready.user.id, "53908099506183680");
  assert.equal(ready.guilds.length, 2);
  assert.equal(ready.guilds[0]?.id, "41771983423143937");
  assert.equal("v" in ready, false);
  assert.equal("heartbeat_interval" in ready, false);
  assert.equal("trace" in ready, false);
  assert.equal(ready.application?.id, "613425648685547541");
  assert.equal(ready.application !== undefined && "flags" in ready.application, false);
  const firstGuild = ready.guilds[0];
  assert.ok(firstGuild !== undefined);
  assert.equal("name" in firstGuild, false);
  assert.equal("members" in firstGuild, false);
});

test("Rest message list fixture copy-decodes each inbound message and drops extras", () => {
  const payload = readFixture("message-list.json");
  assert.equal(Array.isArray(payload), true);
  if (!Array.isArray(payload)) {
    return;
  }
  assert.equal(payload.length >= 3, true);
  assertHasExtraKeys(payload[0], ["webhook_id", "flags"]);
  const messages = decodeMessageList(payload);
  assert.equal(messages.length, payload.length);
  assert.equal(messages[0]?.id, "334385199974967042");
  assert.equal(messages[1]?.id, "334385199974967043");
  assert.equal(messages[2]?.id, "334385199974967044");
  assert.equal("webhook_id" in (messages[0] ?? {}), false);
  assert.equal("flags" in (messages[0] ?? {}), false);
});
