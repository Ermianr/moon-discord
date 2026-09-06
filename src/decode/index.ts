import { DecodeError } from "../errors.js";

export type Snowflake = string;
export type Timestamp = string;

export type GetGateway = {
  url: string;
};

export type SessionStartLimit = {
  total: number;
  remaining: number;
  reset_after: number;
  max_concurrency: number;
};

export type GetGatewayBot = {
  url: string;
  shards: number;
  session_start_limit: SessionStartLimit;
};

export function decodeGetGateway(value: unknown): GetGateway {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("url" in value)) {
    throw new DecodeError("Get Gateway body must be an object with url");
  }
  const url = value.url;
  if (typeof url !== "string") {
    throw new DecodeError("Get Gateway url must be a string");
  }
  return { url };
}

export function decodeGetGatewayBot(value: unknown): GetGatewayBot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError("Get Gateway Bot body must be an object");
  }
  if (!("url" in value) || !("shards" in value) || !("session_start_limit" in value)) {
    throw new DecodeError("Get Gateway Bot body must include url, shards, and session_start_limit");
  }
  const url = value.url;
  const shards = value.shards;
  if (typeof url !== "string") {
    throw new DecodeError("Get Gateway Bot url must be a string");
  }
  if (typeof shards !== "number") {
    throw new DecodeError("Get Gateway Bot shards must be a number");
  }
  return {
    url,
    shards,
    session_start_limit: decodeSessionStartLimit(value.session_start_limit),
  };
}

export type ReadyGuild = {
  id: Snowflake;
};

export type Ready = {
  session_id: string;
  resume_gateway_url: string;
  user: User;
  guilds: ReadyGuild[];
};

export function decodeReady(value: unknown): Ready {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError("READY body must be an object");
  }
  if (
    !("session_id" in value) ||
    !("resume_gateway_url" in value) ||
    !("user" in value) ||
    !("guilds" in value)
  ) {
    throw new DecodeError("READY body must include session_id, resume_gateway_url, user, and guilds");
  }
  const session_id = value.session_id;
  const resume_gateway_url = value.resume_gateway_url;
  if (typeof session_id !== "string") {
    throw new DecodeError("READY session_id must be a string");
  }
  if (typeof resume_gateway_url !== "string") {
    throw new DecodeError("READY resume_gateway_url must be a string");
  }
  return {
    session_id,
    resume_gateway_url,
    user: decodeUser(value.user, "READY.user"),
    guilds: decodeReadyGuilds(value.guilds),
  };
}

function decodeReadyGuilds(value: unknown): ReadyGuild[] {
  if (!Array.isArray(value)) {
    throw new DecodeError("READY guilds must be an array");
  }
  const guilds: ReadyGuild[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry) || !("id" in entry)) {
      throw new DecodeError(`READY.guilds[${String(index)}] must be an object with id`);
    }
    guilds.push({ id: decodeSnowflake(entry.id, `READY.guilds[${String(index)}].id`) });
  }
  return guilds;
}

function decodeSessionStartLimit(value: unknown): SessionStartLimit {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError("session_start_limit must be an object");
  }
  if (
    !("total" in value) ||
    !("remaining" in value) ||
    !("reset_after" in value) ||
    !("max_concurrency" in value)
  ) {
    throw new DecodeError("session_start_limit is missing required fields");
  }
  const total = value.total;
  const remaining = value.remaining;
  const reset_after = value.reset_after;
  const max_concurrency = value.max_concurrency;
  if (
    typeof total !== "number" ||
    typeof remaining !== "number" ||
    typeof reset_after !== "number" ||
    typeof max_concurrency !== "number"
  ) {
    throw new DecodeError("session_start_limit fields must be numbers");
  }
  return { total, remaining, reset_after, max_concurrency };
}

export type User = {
  id: Snowflake;
  username: string;
  discriminator: string;
  avatar: string | null;
};

export type Attachment = {
  id: Snowflake;
};

export type Embed = {
  title?: string;
};

export type Message = {
  id: Snowflake;
  channel_id: Snowflake;
  author: User;
  content: string;
  timestamp: Timestamp;
  edited_timestamp: Timestamp | null;
  tts: boolean;
  mention_everyone: boolean;
  mentions: User[];
  mention_roles: Snowflake[];
  attachments: Attachment[];
  embeds: Embed[];
  pinned: boolean;
  type: number;
};

export type CreateMessage = {
  content?: string;
  nonce?: string | number;
  tts?: boolean;
  flags?: number;
  enforce_nonce?: boolean;
};

export type Sticker = {
  id: Snowflake;
  name: string;
  description: string | null;
  tags: string;
  type: number;
  format_type: number;
};

export function decodeSticker(value: unknown): Sticker {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError("Sticker body must be an object");
  }
  if (
    !("id" in value) ||
    !("name" in value) ||
    !("description" in value) ||
    !("tags" in value) ||
    !("type" in value) ||
    !("format_type" in value)
  ) {
    throw new DecodeError("Sticker body is missing required fields");
  }
  const name = value.name;
  const description = value.description;
  const tags = value.tags;
  const type = value.type;
  const format_type = value.format_type;
  if (typeof name !== "string") {
    throw new DecodeError("Sticker name must be a string");
  }
  if (description !== null && typeof description !== "string") {
    throw new DecodeError("Sticker description must be a string or null");
  }
  if (typeof tags !== "string") {
    throw new DecodeError("Sticker tags must be a string");
  }
  if (typeof type !== "number" || typeof format_type !== "number") {
    throw new DecodeError("Sticker type and format_type must be numbers");
  }
  return {
    id: decodeSnowflake(value.id, "Sticker.id"),
    name,
    description,
    tags,
    type,
    format_type,
  };
}

export function decodeSnowflake(value: unknown, field: string): Snowflake {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  throw new DecodeError(`${field} must be a Snowflake string or safe integer`);
}

export function decodeTimestamp(value: unknown, field: string): Timestamp {
  if (typeof value !== "string") {
    throw new DecodeError(`${field} must be an ISO8601 timestamp string`);
  }
  return value;
}

export function encodeCreateMessage(body: CreateMessage): string {
  const payload: CreateMessage = {};
  if ("content" in body) {
    payload.content = body.content;
  }
  if ("nonce" in body) {
    payload.nonce = body.nonce;
  }
  if ("tts" in body) {
    payload.tts = body.tts;
  }
  if ("flags" in body) {
    payload.flags = body.flags;
  }
  if ("enforce_nonce" in body) {
    payload.enforce_nonce = body.enforce_nonce;
  }
  return JSON.stringify(payload);
}

export function decodeMessage(value: unknown): Message {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError("Message body must be an object");
  }
  if (
    !("id" in value) ||
    !("channel_id" in value) ||
    !("author" in value) ||
    !("content" in value) ||
    !("timestamp" in value) ||
    !("edited_timestamp" in value) ||
    !("tts" in value) ||
    !("mention_everyone" in value) ||
    !("mentions" in value) ||
    !("mention_roles" in value) ||
    !("attachments" in value) ||
    !("embeds" in value) ||
    !("pinned" in value) ||
    !("type" in value)
  ) {
    throw new DecodeError("Message body is missing required fields");
  }
  const content = value.content;
  const tts = value.tts;
  const mention_everyone = value.mention_everyone;
  const pinned = value.pinned;
  const type = value.type;
  if (typeof content !== "string") {
    throw new DecodeError("Message content must be a string");
  }
  if (typeof tts !== "boolean" || typeof mention_everyone !== "boolean" || typeof pinned !== "boolean") {
    throw new DecodeError("Message tts, mention_everyone, and pinned must be booleans");
  }
  if (typeof type !== "number") {
    throw new DecodeError("Message type must be a number");
  }
  return {
    id: decodeSnowflake(value.id, "Message.id"),
    channel_id: decodeSnowflake(value.channel_id, "Message.channel_id"),
    author: decodeUser(value.author, "Message.author"),
    content,
    timestamp: decodeTimestamp(value.timestamp, "Message.timestamp"),
    edited_timestamp: decodeNullableTimestamp(value.edited_timestamp, "Message.edited_timestamp"),
    tts,
    mention_everyone,
    mentions: decodeUserArray(value.mentions, "Message.mentions"),
    mention_roles: decodeSnowflakeArray(value.mention_roles, "Message.mention_roles"),
    attachments: decodeAttachmentArray(value.attachments),
    embeds: decodeEmbedArray(value.embeds),
    pinned,
    type,
  };
}

export function decodeMessageList(value: unknown): Message[] {
  if (!Array.isArray(value)) {
    throw new DecodeError("Message list body must be an array");
  }
  const messages: Message[] = [];
  for (let index = 0; index < value.length; index += 1) {
    messages.push(decodeMessage(value[index]));
  }
  return messages;
}

function decodeNullableTimestamp(value: unknown, field: string): Timestamp | null {
  if (value === null) {
    return null;
  }
  return decodeTimestamp(value, field);
}

function decodeUser(value: unknown, field: string): User {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError(`${field} must be an object`);
  }
  if (!("id" in value) || !("username" in value) || !("discriminator" in value) || !("avatar" in value)) {
    throw new DecodeError(`${field} is missing required fields`);
  }
  const username = value.username;
  const discriminator = value.discriminator;
  const avatar = value.avatar;
  if (typeof username !== "string" || typeof discriminator !== "string") {
    throw new DecodeError(`${field} username and discriminator must be strings`);
  }
  if (avatar !== null && typeof avatar !== "string") {
    throw new DecodeError(`${field} avatar must be a string or null`);
  }
  return {
    id: decodeSnowflake(value.id, `${field}.id`),
    username,
    discriminator,
    avatar,
  };
}

function decodeUserArray(value: unknown, field: string): User[] {
  if (!Array.isArray(value)) {
    throw new DecodeError(`${field} must be an array`);
  }
  const users: User[] = [];
  for (let index = 0; index < value.length; index += 1) {
    users.push(decodeUser(value[index], `${field}[${index}]`));
  }
  return users;
}

function decodeSnowflakeArray(value: unknown, field: string): Snowflake[] {
  if (!Array.isArray(value)) {
    throw new DecodeError(`${field} must be an array`);
  }
  const ids: Snowflake[] = [];
  for (let index = 0; index < value.length; index += 1) {
    ids.push(decodeSnowflake(value[index], `${field}[${index}]`));
  }
  return ids;
}

function decodeAttachmentArray(value: unknown): Attachment[] {
  if (!Array.isArray(value)) {
    throw new DecodeError("Message.attachments must be an array");
  }
  const attachments: Attachment[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry) || !("id" in entry)) {
      throw new DecodeError(`Message.attachments[${index}] must be an object with id`);
    }
    attachments.push({ id: decodeSnowflake(entry.id, `Message.attachments[${index}].id`) });
  }
  return attachments;
}

function decodeEmbedArray(value: unknown): Embed[] {
  if (!Array.isArray(value)) {
    throw new DecodeError("Message.embeds must be an array");
  }
  const embeds: Embed[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new DecodeError(`Message.embeds[${index}] must be an object`);
    }
    const embed: Embed = {};
    if ("title" in entry) {
      const title = entry.title;
      if (typeof title !== "string") {
        throw new DecodeError(`Message.embeds[${index}].title must be a string`);
      }
      embed.title = title;
    }
    embeds.push(embed);
  }
  return embeds;
}
