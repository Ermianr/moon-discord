export type ClientOptions = {
  token: string;
  intents?: number;
  shards?: "recommended" | { id: number; count: number };
  publicKey?: string;
};
