import { DecodeError } from "../errors.js";
import { decodeSnowflake, decodeTimestamp, type Snowflake, type Timestamp } from "./scalars.js";

export type { Snowflake, Timestamp };
export { decodeSnowflake, decodeTimestamp };

export {
  decodeApplicationCommand,
  decodeApplicationCommandList,
  decodeCurrentApplication,
  decodeGuildApplicationCommandPermissions,
  decodeGuildApplicationCommandPermissionsList,
  encodeApplicationCommandList,
  encodeCreateApplicationCommand,
  encodeEditApplicationCommand,
  type ApplicationCommand,
  type ApplicationCommandOption,
  type ApplicationCommandPermission,
  type CreateApplicationCommand,
  type CurrentApplication,
  type EditApplicationCommand,
  type GuildApplicationCommandPermissions,
} from "./commands.js";

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

export type ReadyApplication = {
  id: Snowflake;
};

export type Ready = {
  session_id: string;
  resume_gateway_url: string;
  user: User;
  guilds: ReadyGuild[];
  application?: ReadyApplication;
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
  const ready: Ready = {
    session_id,
    resume_gateway_url,
    user: decodeUser(value.user, "READY.user"),
    guilds: decodeReadyGuilds(value.guilds),
  };
  if ("application" in value) {
    ready.application = decodeReadyApplication(value.application);
  }
  return ready;
}

function decodeReadyApplication(value: unknown): ReadyApplication {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("id" in value)) {
    throw new DecodeError("READY.application must be an object with id");
  }
  return { id: decodeSnowflake(value.id, "READY.application.id") };
}

export type Resumed = {};

export function decodeResumed(value: unknown): Resumed {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DecodeError("RESUMED body must be an object");
  }
  return {};
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

export type GuildMember = {
  user?: User;
};

export type GuildMembersChunk = {
  guild_id: Snowflake;
  members: GuildMember[];
  chunk_index: number;
  chunk_count: number;
  nonce?: string;
};

export function decodeGuildMembersChunk(value: unknown): GuildMembersChunk {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError("GUILD_MEMBERS_CHUNK body must be an object");
  }
  if (!("guild_id" in value) || !("members" in value) || !("chunk_index" in value) || !("chunk_count" in value)) {
    throw new DecodeError("GUILD_MEMBERS_CHUNK body is missing required fields");
  }
  const chunk_index = value.chunk_index;
  const chunk_count = value.chunk_count;
  if (typeof chunk_index !== "number" || typeof chunk_count !== "number") {
    throw new DecodeError("GUILD_MEMBERS_CHUNK chunk_index and chunk_count must be numbers");
  }
  if (!Array.isArray(value.members)) {
    throw new DecodeError("GUILD_MEMBERS_CHUNK members must be an array");
  }
  const members: GuildMember[] = [];
  for (let index = 0; index < value.members.length; index += 1) {
    members.push(decodeGuildMember(value.members[index], `GUILD_MEMBERS_CHUNK.members[${index}]`));
  }
  const chunk: GuildMembersChunk = {
    guild_id: decodeSnowflake(value.guild_id, "GUILD_MEMBERS_CHUNK.guild_id"),
    members,
    chunk_index,
    chunk_count,
  };
  if ("nonce" in value) {
    const nonce = value.nonce;
    if (typeof nonce !== "string") {
      throw new DecodeError("GUILD_MEMBERS_CHUNK nonce must be a string");
    }
    chunk.nonce = nonce;
  }
  return chunk;
}

export type RateLimitedMeta = {
  guild_id?: Snowflake;
  nonce?: string;
};

export type RateLimited = {
  opcode: number;
  retry_after: number;
  meta: RateLimitedMeta;
};

export function decodeRateLimited(value: unknown): RateLimited {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError("RATE_LIMITED body must be an object");
  }
  if (!("opcode" in value) || !("retry_after" in value) || !("meta" in value)) {
    throw new DecodeError("RATE_LIMITED body is missing required fields");
  }
  const opcode = value.opcode;
  const retry_after = value.retry_after;
  if (typeof opcode !== "number" || typeof retry_after !== "number") {
    throw new DecodeError("RATE_LIMITED opcode and retry_after must be numbers");
  }
  if (typeof value.meta !== "object" || value.meta === null || Array.isArray(value.meta)) {
    throw new DecodeError("RATE_LIMITED meta must be an object");
  }
  const meta: RateLimitedMeta = {};
  if ("guild_id" in value.meta) {
    meta.guild_id = decodeSnowflake(value.meta.guild_id, "RATE_LIMITED.meta.guild_id");
  }
  if ("nonce" in value.meta) {
    const nonce = value.meta.nonce;
    if (typeof nonce !== "string") {
      throw new DecodeError("RATE_LIMITED.meta.nonce must be a string");
    }
    meta.nonce = nonce;
  }
  return { opcode, retry_after, meta };
}

export type ChannelInfoChannel = {
  id: Snowflake;
  status?: string | null;
  voice_start_time?: number | null;
};

export type ChannelInfo = {
  guild_id: Snowflake;
  channels: ChannelInfoChannel[];
};

export function decodeChannelInfo(value: unknown): ChannelInfo {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError("CHANNEL_INFO body must be an object");
  }
  if (!("guild_id" in value) || !("channels" in value)) {
    throw new DecodeError("CHANNEL_INFO body is missing required fields");
  }
  if (!Array.isArray(value.channels)) {
    throw new DecodeError("CHANNEL_INFO channels must be an array");
  }
  const channels: ChannelInfoChannel[] = [];
  for (let index = 0; index < value.channels.length; index += 1) {
    channels.push(decodeChannelInfoChannel(value.channels[index], `CHANNEL_INFO.channels[${index}]`));
  }
  return {
    guild_id: decodeSnowflake(value.guild_id, "CHANNEL_INFO.guild_id"),
    channels,
  };
}

export type SoundboardSound = {
  sound_id: Snowflake;
};

export type SoundboardSounds = {
  guild_id: Snowflake;
  soundboard_sounds: SoundboardSound[];
};

export function decodeSoundboardSounds(value: unknown): SoundboardSounds {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError("SOUNDBOARD_SOUNDS body must be an object");
  }
  if (!("guild_id" in value) || !("soundboard_sounds" in value)) {
    throw new DecodeError("SOUNDBOARD_SOUNDS body is missing required fields");
  }
  if (!Array.isArray(value.soundboard_sounds)) {
    throw new DecodeError("SOUNDBOARD_SOUNDS soundboard_sounds must be an array");
  }
  const soundboard_sounds: SoundboardSound[] = [];
  for (let index = 0; index < value.soundboard_sounds.length; index += 1) {
    const entry = value.soundboard_sounds[index];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry) || !("sound_id" in entry)) {
      throw new DecodeError(`SOUNDBOARD_SOUNDS.soundboard_sounds[${index}] must be an object with sound_id`);
    }
    soundboard_sounds.push({
      sound_id: decodeSnowflake(entry.sound_id, `SOUNDBOARD_SOUNDS.soundboard_sounds[${index}].sound_id`),
    });
  }
  return {
    guild_id: decodeSnowflake(value.guild_id, "SOUNDBOARD_SOUNDS.guild_id"),
    soundboard_sounds,
  };
}

function decodeGuildMember(value: unknown, field: string): GuildMember {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError(`${field} must be an object`);
  }
  const member: GuildMember = {};
  if ("user" in value) {
    member.user = decodeUser(value.user, `${field}.user`);
  }
  return member;
}

function decodeChannelInfoChannel(value: unknown, field: string): ChannelInfoChannel {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("id" in value)) {
    throw new DecodeError(`${field} must be an object with id`);
  }
  const channel: ChannelInfoChannel = { id: decodeSnowflake(value.id, `${field}.id`) };
  if ("status" in value) {
    const status = value.status;
    if (status !== null && typeof status !== "string") {
      throw new DecodeError(`${field}.status must be a string or null`);
    }
    channel.status = status;
  }
  if ("voice_start_time" in value) {
    const voice_start_time = value.voice_start_time;
    if (voice_start_time !== null && typeof voice_start_time !== "number") {
      throw new DecodeError(`${field}.voice_start_time must be a number or null`);
    }
    channel.voice_start_time = voice_start_time;
  }
  return channel;
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

export type InteractionEntitlement = {
  id: Snowflake;
};

export type ApplicationCommandInteractionData = {
  id: Snowflake;
  name: string;
  type: number;
};

export type Interaction = {
  id: Snowflake;
  application_id: Snowflake;
  type: number;
  token: string;
  version: number;
  entitlements: InteractionEntitlement[];
  authorizing_integration_owners: Map<string, Snowflake>;
  attachment_size_limit: number;
  data?: ApplicationCommandInteractionData;
  guild_id?: Snowflake;
  channel_id?: Snowflake;
  user?: User;
  member?: GuildMember;
};

export type InteractionCallbackData = {
  content?: string;
  tts?: boolean;
  flags?: number;
};

export type InteractionResponse = {
  type: number;
  data?: InteractionCallbackData;
};

export function encodeInteractionResponse(body: InteractionResponse): string {
  const payload: InteractionResponse = { type: body.type };
  if ("data" in body && body.data !== undefined) {
    payload.data = encodeInteractionCallbackData(body.data);
  }
  return JSON.stringify(payload);
}

export function decodeInteraction(value: unknown): Interaction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError("INTERACTION_CREATE body must be an object");
  }
  if (
    !("id" in value) ||
    !("application_id" in value) ||
    !("type" in value) ||
    !("token" in value) ||
    !("version" in value) ||
    !("entitlements" in value) ||
    !("authorizing_integration_owners" in value) ||
    !("attachment_size_limit" in value)
  ) {
    throw new DecodeError("INTERACTION_CREATE body is missing required fields");
  }
  const type = value.type;
  const token = value.token;
  const version = value.version;
  const attachment_size_limit = value.attachment_size_limit;
  if (typeof type !== "number" || typeof version !== "number" || typeof attachment_size_limit !== "number") {
    throw new DecodeError("INTERACTION_CREATE type, version, and attachment_size_limit must be numbers");
  }
  if (typeof token !== "string") {
    throw new DecodeError("INTERACTION_CREATE token must be a string");
  }
  const interaction: Interaction = {
    id: decodeSnowflake(value.id, "INTERACTION_CREATE.id"),
    application_id: decodeSnowflake(value.application_id, "INTERACTION_CREATE.application_id"),
    type,
    token,
    version,
    entitlements: decodeInteractionEntitlements(value.entitlements),
    authorizing_integration_owners: decodeAuthorizingIntegrationOwners(value.authorizing_integration_owners),
    attachment_size_limit,
  };
  if ("data" in value && (type === 2 || type === 4)) {
    interaction.data = decodeApplicationCommandInteractionData(value.data);
  }
  if ("guild_id" in value) {
    interaction.guild_id = decodeSnowflake(value.guild_id, "INTERACTION_CREATE.guild_id");
  }
  if ("channel_id" in value) {
    interaction.channel_id = decodeSnowflake(value.channel_id, "INTERACTION_CREATE.channel_id");
  }
  if ("user" in value) {
    interaction.user = decodeUser(value.user, "INTERACTION_CREATE.user");
  }
  if ("member" in value) {
    interaction.member = decodeGuildMember(value.member, "INTERACTION_CREATE.member");
  }
  return interaction;
}

function encodeInteractionCallbackData(data: InteractionCallbackData): InteractionCallbackData {
  const payload: InteractionCallbackData = {};
  if ("content" in data) {
    payload.content = data.content;
  }
  if ("tts" in data) {
    payload.tts = data.tts;
  }
  if ("flags" in data) {
    payload.flags = data.flags;
  }
  return payload;
}

function decodeInteractionEntitlements(value: unknown): InteractionEntitlement[] {
  if (!Array.isArray(value)) {
    throw new DecodeError("INTERACTION_CREATE entitlements must be an array");
  }
  const entitlements: InteractionEntitlement[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry) || !("id" in entry)) {
      throw new DecodeError(`INTERACTION_CREATE.entitlements[${index}] must be an object with id`);
    }
    entitlements.push({ id: decodeSnowflake(entry.id, `INTERACTION_CREATE.entitlements[${index}].id`) });
  }
  return entitlements;
}

function decodeAuthorizingIntegrationOwners(value: unknown): Map<string, Snowflake> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError("INTERACTION_CREATE authorizing_integration_owners must be an object");
  }
  const owners = new Map<string, Snowflake>();
  const keys = Object.keys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      continue;
    }
    owners.set(key, decodeSnowflake(descriptor.value, `INTERACTION_CREATE.authorizing_integration_owners.${key}`));
  }
  return owners;
}

function decodeApplicationCommandInteractionData(value: unknown): ApplicationCommandInteractionData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError("INTERACTION_CREATE.data must be an object");
  }
  if (!("id" in value) || !("name" in value) || !("type" in value)) {
    throw new DecodeError("INTERACTION_CREATE.data is missing required fields");
  }
  const name = value.name;
  const type = value.type;
  if (typeof name !== "string" || typeof type !== "number") {
    throw new DecodeError("INTERACTION_CREATE.data name must be a string and type a number");
  }
  return {
    id: decodeSnowflake(value.id, "INTERACTION_CREATE.data.id"),
    name,
    type,
  };
}
