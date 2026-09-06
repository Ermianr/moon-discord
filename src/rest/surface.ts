import {
  decodeApplicationCommand,
  decodeApplicationCommandList,
  decodeCurrentApplication,
  decodeGetGateway,
  decodeGetGatewayBot,
  decodeGuildApplicationCommandPermissions,
  decodeGuildApplicationCommandPermissionsList,
  decodeMessage,
  decodeSticker,
  encodeApplicationCommandList,
  encodeCreateApplicationCommand,
  encodeCreateMessage,
  encodeEditApplicationCommand,
  encodeInteractionResponse,
  type ApplicationCommand,
  type CreateApplicationCommand,
  type CreateMessage,
  type EditApplicationCommand,
  type GetGateway,
  type GetGatewayBot,
  type GuildApplicationCommandPermissions,
  type InteractionResponse,
  type Message,
  type Snowflake,
  type Sticker,
} from "../decode/index.js";
import { DecodeError, DiscordHttpError } from "../errors.js";
import type { Clock, RestHttp, RestHttpRequest, RestHttpResponse } from "../ports.js";
import {
  encodeNamedForm,
  encodePayloadJsonFiles,
  filePart,
  type OutboundFile,
} from "./multipart.js";
import { rateLimitedHttp } from "./rate-limit.js";
import { rejectUnlessOk, responseBodyText } from "./http-error.js";

export type { OutboundFile };

const USER_AGENT = "DiscordBot (https://github.com/Ermianr/moon-discord, 0.0.0)";
const API_BASE = "https://discord.com/api/v10";

export type RestCallOptions = {
  signal?: AbortSignal;
};

export type RestExecuteOptions = {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  files?: OutboundFile[];
  auditReason?: string;
  signal?: AbortSignal;
};

export type CreateMessageBody = CreateMessage & {
  files?: OutboundFile[];
};

export type CreateGuildSticker = {
  name: string;
  description: string;
  tags: string;
  file: OutboundFile;
};

export type RestSurface = {
  execute: (request: RestExecuteOptions) => Promise<unknown>;
  getGateway: (options?: RestCallOptions) => Promise<GetGateway>;
  getGatewayBot: (options?: RestCallOptions) => Promise<GetGatewayBot>;
  createMessage: (channelId: Snowflake, body: CreateMessageBody, options?: RestCallOptions) => Promise<Message>;
  deleteMessage: (channelId: Snowflake, messageId: Snowflake, options?: RestCallOptions) => Promise<void>;
  createGuildSticker: (guildId: Snowflake, body: CreateGuildSticker, options?: RestCallOptions) => Promise<Sticker>;
  getGlobalApplicationCommands: (options?: RestCallOptions) => Promise<ApplicationCommand[]>;
  createGlobalApplicationCommand: (
    body: CreateApplicationCommand,
    options?: RestCallOptions,
  ) => Promise<ApplicationCommand>;
  getGlobalApplicationCommand: (commandId: Snowflake, options?: RestCallOptions) => Promise<ApplicationCommand>;
  editGlobalApplicationCommand: (
    commandId: Snowflake,
    body: EditApplicationCommand,
    options?: RestCallOptions,
  ) => Promise<ApplicationCommand>;
  deleteGlobalApplicationCommand: (commandId: Snowflake, options?: RestCallOptions) => Promise<void>;
  bulkOverwriteGlobalApplicationCommands: (
    body: CreateApplicationCommand[],
    options?: RestCallOptions,
  ) => Promise<ApplicationCommand[]>;
  getGuildApplicationCommands: (guildId: Snowflake, options?: RestCallOptions) => Promise<ApplicationCommand[]>;
  createGuildApplicationCommand: (
    guildId: Snowflake,
    body: CreateApplicationCommand,
    options?: RestCallOptions,
  ) => Promise<ApplicationCommand>;
  getGuildApplicationCommand: (
    guildId: Snowflake,
    commandId: Snowflake,
    options?: RestCallOptions,
  ) => Promise<ApplicationCommand>;
  editGuildApplicationCommand: (
    guildId: Snowflake,
    commandId: Snowflake,
    body: EditApplicationCommand,
    options?: RestCallOptions,
  ) => Promise<ApplicationCommand>;
  deleteGuildApplicationCommand: (
    guildId: Snowflake,
    commandId: Snowflake,
    options?: RestCallOptions,
  ) => Promise<void>;
  bulkOverwriteGuildApplicationCommands: (
    guildId: Snowflake,
    body: CreateApplicationCommand[],
    options?: RestCallOptions,
  ) => Promise<ApplicationCommand[]>;
  getGuildApplicationCommandPermissions: (
    guildId: Snowflake,
    options?: RestCallOptions,
  ) => Promise<GuildApplicationCommandPermissions[]>;
  getApplicationCommandPermissions: (
    guildId: Snowflake,
    commandId: Snowflake,
    options?: RestCallOptions,
  ) => Promise<GuildApplicationCommandPermissions>;
  createInteractionResponse: (
    interactionId: Snowflake,
    interactionToken: string,
    body: InteractionResponse,
    options?: RestCallOptions,
  ) => Promise<void>;
  getOriginalInteractionResponse: (interactionToken: string, options?: RestCallOptions) => Promise<Message>;
  editOriginalInteractionResponse: (
    interactionToken: string,
    body: CreateMessage,
    options?: RestCallOptions,
  ) => Promise<Message>;
  deleteOriginalInteractionResponse: (interactionToken: string, options?: RestCallOptions) => Promise<void>;
  createFollowupMessage: (
    interactionToken: string,
    body: CreateMessage,
    options?: RestCallOptions,
  ) => Promise<Message>;
  getFollowupMessage: (
    interactionToken: string,
    messageId: Snowflake,
    options?: RestCallOptions,
  ) => Promise<Message>;
  editFollowupMessage: (
    interactionToken: string,
    messageId: Snowflake,
    body: CreateMessage,
    options?: RestCallOptions,
  ) => Promise<Message>;
  deleteFollowupMessage: (
    interactionToken: string,
    messageId: Snowflake,
    options?: RestCallOptions,
  ) => Promise<void>;
};

export type ApplicationIdentity = {
  id: string | undefined;
};

export type CreateMessageDispatch = (
  channelId: Snowflake,
  body: CreateMessageBody,
  options?: RestCallOptions,
) => Promise<RestHttpResponse>;

export function createCreateMessageDispatch(http: RestHttp, token: string, clock: Clock): CreateMessageDispatch {
  return createMessageDispatch(rateLimitedHttp(http, clock, undefined), token, undefined);
}

function createMessageDispatch(
  http: RestHttp,
  token: string,
  onUnauthorized?: (error: Error) => void,
): CreateMessageDispatch {
  const botHeaders = {
    Authorization: `Bot ${token}`,
    "User-Agent": USER_AGENT,
  };
  return async (channelId, body, options) => {
    const json = encodeCreateMessage(body);
    const files = "files" in body ? body.files : undefined;
    const headers: Record<string, string> = {
      ...botHeaders,
      "Content-Type": "application/json",
    };
    const httpRequest: RestHttpRequest = {
      method: "POST",
      url: `${API_BASE}/channels/${channelId}/messages`,
      headers,
      body: json,
    };
    if (files !== undefined && files.length > 0) {
      const encoded = encodePayloadJsonFiles(json, files);
      headers["Content-Type"] = encoded.contentType;
      httpRequest.body = encoded.body;
    }
    attachSignal(httpRequest, options);
    const response = await http.request(httpRequest);
    try {
      rejectUnlessOk(response);
    } catch (error: unknown) {
      if (onUnauthorized !== undefined && error instanceof DiscordHttpError && error.status === 401) {
        onUnauthorized(error);
      }
      throw error;
    }
    return response;
  };
}

type TokenDeath = {
  dead: boolean;
  error: DiscordHttpError;
};

export function createRest(
  http: RestHttp,
  token: string,
  clock: Clock,
  onUnauthorized?: (error: Error) => void,
  tokenDeath?: TokenDeath,
  applicationIdentity?: ApplicationIdentity,
): RestSurface {
  http = rateLimitedHttp(http, clock, tokenDeath);
  const notifyUnauthorized = (error: Error): void => {
    if (onUnauthorized !== undefined && error instanceof DiscordHttpError && error.status === 401) {
      onUnauthorized(error);
    }
  };
  const limited = http;
  http = {
    request: async (request) => {
      try {
        return await limited.request(request);
      } catch (error: unknown) {
        if (error instanceof Error) {
          notifyUnauthorized(error);
        }
        throw error;
      }
    },
  };
  const botHeaders = {
    Authorization: `Bot ${token}`,
    "User-Agent": USER_AGENT,
  };
  const rejectHttp = (response: RestHttpResponse): void => {
    try {
      rejectUnlessOk(response);
    } catch (error: unknown) {
      if (onUnauthorized !== undefined && error instanceof DiscordHttpError && error.status === 401) {
        onUnauthorized(error);
      }
      throw error;
    }
  };
  const dispatchCreateMessage = createMessageDispatch(http, token, onUnauthorized);
  const identity: ApplicationIdentity = applicationIdentity !== undefined ? applicationIdentity : { id: undefined };
  let applicationIdWait: Promise<string> | undefined;
  const resolveApplicationId = async (options?: RestCallOptions): Promise<string> => {
    if (identity.id !== undefined) {
      return identity.id;
    }
    if (applicationIdWait !== undefined) {
      return applicationIdWait;
    }
    applicationIdWait = (async () => {
      throwIfTokenDead(tokenDeath);
      const httpRequest: RestHttpRequest = {
        method: "GET",
        url: `${API_BASE}/applications/@me`,
        headers: botHeaders,
      };
      attachSignal(httpRequest, options);
      const response = await http.request(httpRequest);
      rejectHttp(response);
      const application = decodeCurrentApplication(parseJsonBody(response, "Get Current Application"));
      identity.id = application.id;
      return application.id;
    })();
    try {
      return await applicationIdWait;
    } finally {
      applicationIdWait = undefined;
    }
  };
  const send = async (
    method: string,
    url: string,
    options: RestCallOptions | undefined,
    body?: string,
    skipGlobalRateLimit?: boolean,
  ): Promise<RestHttpResponse> => {
    throwIfTokenDead(tokenDeath);
    const headers: Record<string, string> = { ...botHeaders };
    const httpRequest: RestHttpRequest = { method, url, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      httpRequest.body = body;
    }
    if (skipGlobalRateLimit === true) {
      httpRequest.skipGlobalRateLimit = true;
    }
    attachSignal(httpRequest, options);
    const response = await http.request(httpRequest);
    rejectHttp(response);
    return response;
  };
  const commandsUrl = async (suffix: string, options?: RestCallOptions): Promise<string> => {
    const applicationId = await resolveApplicationId(options);
    return `${API_BASE}/applications/${applicationId}${suffix}`;
  };
  const followupUrl = async (suffix: string, options?: RestCallOptions): Promise<string> => {
    const applicationId = await resolveApplicationId(options);
    return `${API_BASE}/webhooks/${applicationId}${suffix}`;
  };
  return {
    execute: async (request) => {
      throwIfTokenDead(tokenDeath);
      const headers: Record<string, string> = {
        ...botHeaders,
      };
      if ("auditReason" in request && request.auditReason !== undefined) {
        headers["X-Audit-Log-Reason"] = encodeURIComponent(request.auditReason);
      }
      const httpRequest: RestHttpRequest = {
        method: request.method,
        url: hatchUrl(request.path, request.query),
        headers,
      };
      const files = "files" in request ? request.files : undefined;
      if (files !== undefined && files.length > 0) {
        const payloadJson = JSON.stringify("body" in request && request.body !== undefined ? request.body : {});
        const encoded = encodePayloadJsonFiles(payloadJson, files);
        headers["Content-Type"] = encoded.contentType;
        httpRequest.body = encoded.body;
      } else if ("body" in request && request.body !== undefined) {
        headers["Content-Type"] = "application/json";
        httpRequest.body = JSON.stringify(request.body);
      }
      attachSignal(httpRequest, request);
      const response = await http.request(httpRequest);
      rejectHttp(response);
      const text = responseBodyText(response);
      if (text === "") {
        return undefined;
      }
      const parsed: unknown = JSON.parse(text);
      return parsed;
    },
    getGateway: async (options) => {
      throwIfTokenDead(tokenDeath);
      const httpRequest: RestHttpRequest = {
        method: "GET",
        url: `${API_BASE}/gateway`,
        headers: {
          "User-Agent": USER_AGENT,
        },
      };
      attachSignal(httpRequest, options);
      const response = await http.request(httpRequest);
      rejectHttp(response);
      return decodeGetGateway(parseJsonBody(response, "Get Gateway"));
    },
    getGatewayBot: async (options) => {
      throwIfTokenDead(tokenDeath);
      const httpRequest: RestHttpRequest = {
        method: "GET",
        url: `${API_BASE}/gateway/bot`,
        headers: botHeaders,
      };
      attachSignal(httpRequest, options);
      const response = await http.request(httpRequest);
      rejectHttp(response);
      return decodeGetGatewayBot(parseJsonBody(response, "Get Gateway Bot"));
    },
    createMessage: async (channelId, body, options) => {
      throwIfTokenDead(tokenDeath);
      const response = await dispatchCreateMessage(channelId, body, options);
      return decodeMessage(parseJsonBody(response, "Create Message"));
    },
    deleteMessage: async (channelId, messageId, options) => {
      throwIfTokenDead(tokenDeath);
      const httpRequest: RestHttpRequest = {
        method: "DELETE",
        url: `${API_BASE}/channels/${channelId}/messages/${messageId}`,
        headers: botHeaders,
      };
      attachSignal(httpRequest, options);
      const response = await http.request(httpRequest);
      rejectHttp(response);
    },
    createGuildSticker: async (guildId, body, options) => {
      throwIfTokenDead(tokenDeath);
      const encoded = encodeNamedForm([
        { name: "name", body: utf8(body.name) },
        { name: "description", body: utf8(body.description) },
        { name: "tags", body: utf8(body.tags) },
        filePart("file", "file" in body ? body.file : undefined, "file"),
      ]);
      const httpRequest: RestHttpRequest = {
        method: "POST",
        url: `${API_BASE}/guilds/${guildId}/stickers`,
        headers: {
          ...botHeaders,
          "Content-Type": encoded.contentType,
        },
        body: encoded.body,
      };
      attachSignal(httpRequest, options);
      const response = await http.request(httpRequest);
      rejectHttp(response);
      return decodeSticker(parseJsonBody(response, "Create Guild Sticker"));
    },
    getGlobalApplicationCommands: async (options) => {
      const response = await send("GET", await commandsUrl("/commands", options), options);
      return decodeApplicationCommandList(parseJsonBody(response, "Get Global Application Commands"));
    },
    createGlobalApplicationCommand: async (body, options) => {
      const response = await send(
        "POST",
        await commandsUrl("/commands", options),
        options,
        encodeCreateApplicationCommand(body),
      );
      return decodeApplicationCommand(parseJsonBody(response, "Create Global Application Command"));
    },
    getGlobalApplicationCommand: async (commandId, options) => {
      const response = await send("GET", await commandsUrl(`/commands/${commandId}`, options), options);
      return decodeApplicationCommand(parseJsonBody(response, "Get Global Application Command"));
    },
    editGlobalApplicationCommand: async (commandId, body, options) => {
      const response = await send(
        "PATCH",
        await commandsUrl(`/commands/${commandId}`, options),
        options,
        encodeEditApplicationCommand(body),
      );
      return decodeApplicationCommand(parseJsonBody(response, "Edit Global Application Command"));
    },
    deleteGlobalApplicationCommand: async (commandId, options) => {
      await send("DELETE", await commandsUrl(`/commands/${commandId}`, options), options);
    },
    bulkOverwriteGlobalApplicationCommands: async (body, options) => {
      const response = await send(
        "PUT",
        await commandsUrl("/commands", options),
        options,
        encodeApplicationCommandList(body),
      );
      return decodeApplicationCommandList(parseJsonBody(response, "Bulk Overwrite Global Application Commands"));
    },
    getGuildApplicationCommands: async (guildId, options) => {
      const response = await send("GET", await commandsUrl(`/guilds/${guildId}/commands`, options), options);
      return decodeApplicationCommandList(parseJsonBody(response, "Get Guild Application Commands"));
    },
    createGuildApplicationCommand: async (guildId, body, options) => {
      const response = await send(
        "POST",
        await commandsUrl(`/guilds/${guildId}/commands`, options),
        options,
        encodeCreateApplicationCommand(body),
      );
      return decodeApplicationCommand(parseJsonBody(response, "Create Guild Application Command"));
    },
    getGuildApplicationCommand: async (guildId, commandId, options) => {
      const response = await send(
        "GET",
        await commandsUrl(`/guilds/${guildId}/commands/${commandId}`, options),
        options,
      );
      return decodeApplicationCommand(parseJsonBody(response, "Get Guild Application Command"));
    },
    editGuildApplicationCommand: async (guildId, commandId, body, options) => {
      const response = await send(
        "PATCH",
        await commandsUrl(`/guilds/${guildId}/commands/${commandId}`, options),
        options,
        encodeEditApplicationCommand(body),
      );
      return decodeApplicationCommand(parseJsonBody(response, "Edit Guild Application Command"));
    },
    deleteGuildApplicationCommand: async (guildId, commandId, options) => {
      await send("DELETE", await commandsUrl(`/guilds/${guildId}/commands/${commandId}`, options), options);
    },
    bulkOverwriteGuildApplicationCommands: async (guildId, body, options) => {
      const response = await send(
        "PUT",
        await commandsUrl(`/guilds/${guildId}/commands`, options),
        options,
        encodeApplicationCommandList(body),
      );
      return decodeApplicationCommandList(parseJsonBody(response, "Bulk Overwrite Guild Application Commands"));
    },
    getGuildApplicationCommandPermissions: async (guildId, options) => {
      const response = await send(
        "GET",
        await commandsUrl(`/guilds/${guildId}/commands/permissions`, options),
        options,
      );
      return decodeGuildApplicationCommandPermissionsList(
        parseJsonBody(response, "Get Guild Application Command Permissions"),
      );
    },
    getApplicationCommandPermissions: async (guildId, commandId, options) => {
      const response = await send(
        "GET",
        await commandsUrl(`/guilds/${guildId}/commands/${commandId}/permissions`, options),
        options,
      );
      return decodeGuildApplicationCommandPermissions(
        parseJsonBody(response, "Get Application Command Permissions"),
      );
    },
    createInteractionResponse: async (interactionId, interactionToken, body, options) => {
      await send(
        "POST",
        `${API_BASE}/interactions/${interactionId}/${interactionToken}/callback`,
        options,
        encodeInteractionResponse(body),
        true,
      );
    },
    getOriginalInteractionResponse: async (interactionToken, options) => {
      const response = await send(
        "GET",
        await followupUrl(`/${interactionToken}/messages/@original`, options),
        options,
        undefined,
        true,
      );
      return decodeMessage(parseJsonBody(response, "Get Original Interaction Response"));
    },
    editOriginalInteractionResponse: async (interactionToken, body, options) => {
      const response = await send(
        "PATCH",
        await followupUrl(`/${interactionToken}/messages/@original`, options),
        options,
        encodeCreateMessage(body),
        true,
      );
      return decodeMessage(parseJsonBody(response, "Edit Original Interaction Response"));
    },
    deleteOriginalInteractionResponse: async (interactionToken, options) => {
      await send("DELETE", await followupUrl(`/${interactionToken}/messages/@original`, options), options, undefined, true);
    },
    createFollowupMessage: async (interactionToken, body, options) => {
      const response = await send(
        "POST",
        await followupUrl(`/${interactionToken}`, options),
        options,
        encodeCreateMessage(body),
        true,
      );
      return decodeMessage(parseJsonBody(response, "Create Followup Message"));
    },
    getFollowupMessage: async (interactionToken, messageId, options) => {
      const response = await send(
        "GET",
        await followupUrl(`/${interactionToken}/messages/${messageId}`, options),
        options,
        undefined,
        true,
      );
      return decodeMessage(parseJsonBody(response, "Get Followup Message"));
    },
    editFollowupMessage: async (interactionToken, messageId, body, options) => {
      const response = await send(
        "PATCH",
        await followupUrl(`/${interactionToken}/messages/${messageId}`, options),
        options,
        encodeCreateMessage(body),
        true,
      );
      return decodeMessage(parseJsonBody(response, "Edit Followup Message"));
    },
    deleteFollowupMessage: async (interactionToken, messageId, options) => {
      await send(
        "DELETE",
        await followupUrl(`/${interactionToken}/messages/${messageId}`, options),
        options,
        undefined,
        true,
      );
    },
  };
}

function throwIfTokenDead(tokenDeath: TokenDeath | undefined): void {
  if (tokenDeath !== undefined && tokenDeath.dead) {
    throw tokenDeath.error;
  }
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hatchUrl(path: string, query: Record<string, string> | undefined): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (query === undefined) {
    return `${API_BASE}${suffix}`;
  }
  const keys = Object.keys(query);
  if (keys.length === 0) {
    return `${API_BASE}${suffix}`;
  }
  let qs = "";
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) {
      continue;
    }
    const value = query[key];
    if (value === undefined) {
      continue;
    }
    qs += `${qs === "" ? "?" : "&"}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
  return `${API_BASE}${suffix}${qs}`;
}

function attachSignal(request: RestHttpRequest, options: RestCallOptions | undefined): void {
  if (options !== undefined && "signal" in options && options.signal !== undefined) {
    request.signal = options.signal;
  }
}

function parseJsonBody(response: RestHttpResponse, label: string): unknown {
  const text = responseBodyText(response);
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw new DecodeError(`${label} body is not JSON`);
  }
}
