import { Client } from "moon-discord";

new Client({
  token: "bot-token",
  // @ts-expect-error ClientOptions does not accept Rest HTTP ports
  http: { request: async () => ({ status: 200, headers: {}, body: "{}" }) },
});

new Client({
  token: "bot-token",
  // @ts-expect-error ClientOptions does not accept Clock ports
  clock: { nowMs: () => 0, schedule: () => () => {} },
});
