import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gatewayTlsConnectOptions } from "../src/gateway-transport.js";

test("tls.connect options set servername and rejectUnauthorized true", () => {
  assert.deepEqual(gatewayTlsConnectOptions("gateway.discord.gg", 443), {
    host: "gateway.discord.gg",
    port: 443,
    servername: "gateway.discord.gg",
    rejectUnauthorized: true,
  });
});

test("moon-discord/rest module graph does not import node:tls", () => {
  const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");
  const seen = new Set<string>();
  const queue = [path.join(srcRoot, "rest.ts")];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) {
      continue;
    }
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    assert.equal(source.includes("node:tls"), false, file);
    assert.equal(source.includes("gateway-transport"), false, file);
    assert.equal(source.includes("gateway-framing"), false, file);
    const matches = source.matchAll(/from "(\.[^"]+)"/g);
    for (const match of matches) {
      const spec = match[1];
      if (spec === undefined) {
        continue;
      }
      const resolved = path.normalize(path.join(path.dirname(file), spec.replace(/\.js$/, ".ts")));
      queue.push(resolved);
    }
  }
  assert.ok(seen.has(path.join(srcRoot, "rest.ts")));
});
