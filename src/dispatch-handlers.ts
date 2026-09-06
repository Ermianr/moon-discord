import type { Interaction, Message } from "./decode/index.js";

export type DispatchHandler = {
  handle(payload: object): void | Promise<void>;
}["handle"];

export type MessageCreateHandler = {
  handle(payload: Message): void | Promise<void>;
}["handle"];

export type InteractionCreateHandler = {
  handle(payload: Interaction): void | Promise<void>;
}["handle"];
