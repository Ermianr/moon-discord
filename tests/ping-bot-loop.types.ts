import { Client } from "moon-discord";

declare const client: Client;

client.on("MESSAGE_CREATE", (message) => {
  const _id: string = message.id;
  const _channelId: string = message.channel_id;
  const _content: string = message.content;
  const _authorId: string = message.author.id;
  void client.rest.createMessage(_channelId, { content: "pong" });
  // @ts-expect-error inbound MESSAGE_CREATE is not a kitchen-sink optional Message
  const _guildId = message.guild_id;
  // @ts-expect-error extra Discord keys are dropped from the closed inbound struct
  const _flags = message.flags;
});
