import { readFileSync } from "node:fs";
import type { RestHttpResponse } from "../../src/ports.js";
import { createCreateMessageDispatch } from "../../src/rest/surface.js";
import { measureUs, reportSamples } from "../lib/measure.js";

const bodyText = readFileSync("fixtures/rest-dispatch/create-message.json", "utf8");
const parsed: unknown = JSON.parse(bodyText);
if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !("content" in parsed)) {
  throw new Error("create-message fixture must include content");
}
const contentValue = parsed.content;
if (typeof contentValue !== "string") {
  throw new Error("create-message content must be a string");
}
const body = { content: contentValue };

let now = 0;
const dispatch = createCreateMessageDispatch(
  {
    request: async (): Promise<RestHttpResponse> => {
      const headers: Record<string, string> = {
        "x-ratelimit-bucket": "hot-path",
        "x-ratelimit-remaining": "5",
        "x-ratelimit-reset-after": "60",
      };
      return {
        status: 200,
        headers,
        body: "not-json",
      };
    },
  },
  "bot-token",
  {
    nowMs: () => {
      now += 1000;
      return now;
    },
    schedule: () => {
      throw new Error("REST dispatch bench must not wait on Clock");
    },
  },
);

await dispatch("290926798999357250", body);

async function batchDispatch(): Promise<void> {
  for (let i = 0; i < 96; i += 1) {
    await dispatch("290926798999357250", body);
  }
}

const BATCH = 96;
const samples = await measureUs(25, 120, batchDispatch);
const scaled: number[] = [];
for (let i = 0; i < samples.length; i += 1) {
  const value = samples[i];
  if (value !== undefined) {
    scaled.push(value / BATCH);
  }
}
reportSamples(scaled);
