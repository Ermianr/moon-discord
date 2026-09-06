import { Client, GatewayIntent } from "../src/index.js";

const client = new Client(
  {
    token: "missing-token",
    intents: GatewayIntent.Guilds | GatewayIntent.GuildMessages | GatewayIntent.MessageContent,
    shards: "recommended",
  },
  undefined,
);
client.on("MESSAGE_CREATE", () => {
  void client.rest.createMessage(
    "1",
    {
      content: "pong",
      files: [{ filename: "a.txt", bytes: new Uint8Array([97]) }],
    },
    undefined,
  );
});
void client.connect(undefined);
void client;
