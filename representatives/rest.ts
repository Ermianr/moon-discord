import { Client } from "../src/rest.js";

const client = new Client({ token: "missing-token" });
void client.rest.createMessage(
  "1",
  {
    content: "hello",
    files: [{ filename: "a.txt", bytes: new Uint8Array([97]) }],
  },
  undefined,
);
void client.rest.createGuildSticker(
  "1",
  {
    name: "Wave",
    description: "Wumpus waves hello",
    tags: "wumpus",
    file: { filename: "wave.png", bytes: new Uint8Array([137, 80]) },
  },
  undefined,
);
void client;
