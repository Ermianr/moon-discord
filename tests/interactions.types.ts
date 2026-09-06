import { Client } from "moon-discord";

declare const client: Client;

client.on("INTERACTION_CREATE", (interaction) => {
  const _id: string = interaction.id;
  const _token: string = interaction.token;
  const _type: number = interaction.type;
  void client.rest.createInteractionResponse(_id, _token, { type: 4, data: { content: "acked" } });
  void client.rest.createFollowupMessage(_token, { content: "later" });
  // @ts-expect-error extra Discord keys are dropped from the closed inbound struct
  const _locale = interaction.locale;
});
