import { readFileSync } from "node:fs";
import { decodeMessage, decodeMessageList, decodeReady } from "../../src/decode/index.js";
import { measureUs, reportSamples } from "../lib/measure.js";

const messageText = readFileSync("fixtures/decode/guild-message-create.json", "utf8");
const readyText = readFileSync("fixtures/decode/ready.json", "utf8");
const listText = readFileSync("fixtures/decode/message-list.json", "utf8");
const message: unknown = JSON.parse(messageText);
const ready: unknown = JSON.parse(readyText);
const list: unknown = JSON.parse(listText);

const BATCH = 2048;
const samples = await measureUs(40, 200, (): Promise<void> => {
  for (let i = 0; i < BATCH; i += 1) {
    decodeMessage(message);
    decodeReady(ready);
    decodeMessageList(list);
  }
  return Promise.resolve();
});
const scaled: number[] = [];
for (let i = 0; i < samples.length; i += 1) {
  const value = samples[i];
  if (value !== undefined) {
    scaled.push(value / BATCH);
  }
}
reportSamples(scaled);
