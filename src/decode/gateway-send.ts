import type { Snowflake } from "./scalars.js";

export type OutboundActivity = {
  name: string;
  type: number;
};

export type PresenceUpdate = {
  since: number | null;
  activities: OutboundActivity[];
  status: string;
  afk: boolean;
};

export type VoiceStateUpdate = {
  guild_id: Snowflake;
  channel_id: Snowflake | null;
  self_mute: boolean;
  self_deaf: boolean;
};

export type RequestGuildMembers = {
  guild_id: Snowflake;
  query?: string;
  limit?: number;
  presences?: boolean;
  user_ids?: Snowflake | Snowflake[];
  nonce?: string;
};

export type RequestSoundboardSounds = {
  guild_ids: Snowflake[];
};

export type RequestChannelInfo = {
  guild_id: Snowflake;
  fields: string[];
};

const OP_PRESENCE_UPDATE = 3;
const OP_VOICE_STATE_UPDATE = 4;
const OP_REQUEST_GUILD_MEMBERS = 8;
const OP_REQUEST_SOUNDBOARD_SOUNDS = 31;
const OP_REQUEST_CHANNEL_INFO = 43;

export function encodePresenceUpdate(body: PresenceUpdate): { json: string; d: PresenceUpdate } {
  const activities: OutboundActivity[] = [];
  for (let index = 0; index < body.activities.length; index += 1) {
    const activity = body.activities[index];
    if (activity !== undefined) {
      activities.push({ name: activity.name, type: activity.type });
    }
  }
  const d: PresenceUpdate = {
    since: body.since,
    activities,
    status: body.status,
    afk: body.afk,
  };
  return { json: JSON.stringify({ op: OP_PRESENCE_UPDATE, d }), d };
}

export function encodeVoiceStateUpdate(body: VoiceStateUpdate): string {
  const d: VoiceStateUpdate = {
    guild_id: body.guild_id,
    channel_id: body.channel_id,
    self_mute: body.self_mute,
    self_deaf: body.self_deaf,
  };
  return JSON.stringify({ op: OP_VOICE_STATE_UPDATE, d });
}

export function encodeRequestGuildMembers(body: RequestGuildMembers): string {
  const d: {
    guild_id: Snowflake;
    query?: string;
    limit?: number;
    presences?: boolean;
    user_ids?: Snowflake | Snowflake[];
    nonce?: string;
  } = {
    guild_id: body.guild_id,
  };
  if ("query" in body) {
    d.query = body.query;
  }
  if ("limit" in body) {
    d.limit = body.limit;
  }
  if ("presences" in body) {
    d.presences = body.presences;
  }
  if ("user_ids" in body) {
    d.user_ids = body.user_ids;
  }
  if ("nonce" in body) {
    d.nonce = body.nonce;
  }
  return JSON.stringify({ op: OP_REQUEST_GUILD_MEMBERS, d });
}

export function encodeRequestSoundboardSounds(body: RequestSoundboardSounds): string {
  const guild_ids: Snowflake[] = [];
  for (let index = 0; index < body.guild_ids.length; index += 1) {
    const id = body.guild_ids[index];
    if (id !== undefined) {
      guild_ids.push(id);
    }
  }
  return JSON.stringify({ op: OP_REQUEST_SOUNDBOARD_SOUNDS, d: { guild_ids } });
}

export function encodeRequestChannelInfo(body: RequestChannelInfo): string {
  const fields: string[] = [];
  for (let index = 0; index < body.fields.length; index += 1) {
    const field = body.fields[index];
    if (field !== undefined) {
      fields.push(field);
    }
  }
  return JSON.stringify({
    op: OP_REQUEST_CHANNEL_INFO,
    d: { guild_id: body.guild_id, fields },
  });
}
