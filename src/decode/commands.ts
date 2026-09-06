import { DecodeError } from "../errors.js";
import { decodeSnowflake, type Snowflake } from "./scalars.js";

export type ApplicationCommand = {
  id: Snowflake;
  application_id: Snowflake;
  name: string;
  description: string;
  default_member_permissions: string | null;
  version: Snowflake;
  type?: number;
  guild_id?: Snowflake;
  options?: ApplicationCommandOption[];
};

export type ApplicationCommandOption = {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  options?: ApplicationCommandOption[];
};

export type CreateApplicationCommand = {
  name: string;
  description?: string;
  type?: number;
  options?: ApplicationCommandOption[];
  default_member_permissions?: string | null;
  nsfw?: boolean;
};

export type EditApplicationCommand = {
  name?: string;
  description?: string;
  options?: ApplicationCommandOption[];
  default_member_permissions?: string | null;
  nsfw?: boolean;
};

export type ApplicationCommandPermission = {
  id: Snowflake;
  type: number;
  permission: boolean;
};

export type GuildApplicationCommandPermissions = {
  id: Snowflake;
  application_id: Snowflake;
  guild_id: Snowflake;
  permissions: ApplicationCommandPermission[];
};

export type CurrentApplication = {
  id: Snowflake;
};

export function decodeCurrentApplication(value: unknown): CurrentApplication {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("id" in value)) {
    throw new DecodeError("Current Application body must be an object with id");
  }
  return { id: decodeSnowflake(value.id, "Current Application.id") };
}

export function decodeApplicationCommand(value: unknown): ApplicationCommand {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError("Application Command body must be an object");
  }
  if (
    !("id" in value) ||
    !("application_id" in value) ||
    !("name" in value) ||
    !("description" in value) ||
    !("default_member_permissions" in value) ||
    !("version" in value)
  ) {
    throw new DecodeError("Application Command body is missing required fields");
  }
  const name = value.name;
  const description = value.description;
  const default_member_permissions = value.default_member_permissions;
  if (typeof name !== "string" || typeof description !== "string") {
    throw new DecodeError("Application Command name and description must be strings");
  }
  if (default_member_permissions !== null && typeof default_member_permissions !== "string") {
    throw new DecodeError("Application Command default_member_permissions must be a string or null");
  }
  const command: ApplicationCommand = {
    id: decodeSnowflake(value.id, "Application Command.id"),
    application_id: decodeSnowflake(value.application_id, "Application Command.application_id"),
    name,
    description,
    default_member_permissions,
    version: decodeSnowflake(value.version, "Application Command.version"),
  };
  if ("type" in value) {
    const type = value.type;
    if (typeof type !== "number") {
      throw new DecodeError("Application Command type must be a number");
    }
    command.type = type;
  }
  if ("guild_id" in value) {
    command.guild_id = decodeSnowflake(value.guild_id, "Application Command.guild_id");
  }
  if ("options" in value) {
    command.options = decodeOptions(value.options, "Application Command.options");
  }
  return command;
}

export function decodeApplicationCommandList(value: unknown): ApplicationCommand[] {
  if (!Array.isArray(value)) {
    throw new DecodeError("Application Command list body must be an array");
  }
  const commands: ApplicationCommand[] = [];
  for (let index = 0; index < value.length; index += 1) {
    commands.push(decodeApplicationCommand(value[index]));
  }
  return commands;
}

export function decodeGuildApplicationCommandPermissions(value: unknown): GuildApplicationCommandPermissions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError("Application Command Permissions body must be an object");
  }
  if (!("id" in value) || !("application_id" in value) || !("guild_id" in value) || !("permissions" in value)) {
    throw new DecodeError("Application Command Permissions body is missing required fields");
  }
  if (!Array.isArray(value.permissions)) {
    throw new DecodeError("Application Command Permissions permissions must be an array");
  }
  const permissions: ApplicationCommandPermission[] = [];
  for (let index = 0; index < value.permissions.length; index += 1) {
    permissions.push(decodeApplicationCommandPermission(value.permissions[index], index));
  }
  return {
    id: decodeSnowflake(value.id, "Application Command Permissions.id"),
    application_id: decodeSnowflake(value.application_id, "Application Command Permissions.application_id"),
    guild_id: decodeSnowflake(value.guild_id, "Application Command Permissions.guild_id"),
    permissions,
  };
}

export function decodeGuildApplicationCommandPermissionsList(value: unknown): GuildApplicationCommandPermissions[] {
  if (!Array.isArray(value)) {
    throw new DecodeError("Application Command Permissions list body must be an array");
  }
  const list: GuildApplicationCommandPermissions[] = [];
  for (let index = 0; index < value.length; index += 1) {
    list.push(decodeGuildApplicationCommandPermissions(value[index]));
  }
  return list;
}

export function encodeCreateApplicationCommand(body: CreateApplicationCommand): string {
  const payload: CreateApplicationCommand = { name: body.name };
  copyCreateCommandFields(payload, body);
  return JSON.stringify(payload);
}

export function encodeEditApplicationCommand(body: EditApplicationCommand): string {
  const payload: EditApplicationCommand = {};
  if ("name" in body) {
    payload.name = body.name;
  }
  if ("description" in body) {
    payload.description = body.description;
  }
  if ("options" in body && body.options !== undefined) {
    payload.options = encodeOptions(body.options);
  }
  if ("default_member_permissions" in body) {
    payload.default_member_permissions = body.default_member_permissions;
  }
  if ("nsfw" in body) {
    payload.nsfw = body.nsfw;
  }
  return JSON.stringify(payload);
}

export function encodeApplicationCommandList(body: CreateApplicationCommand[]): string {
  const payload: CreateApplicationCommand[] = [];
  for (let index = 0; index < body.length; index += 1) {
    const entry = body[index];
    if (entry === undefined) {
      continue;
    }
    const command: CreateApplicationCommand = { name: entry.name };
    copyCreateCommandFields(command, entry);
    payload.push(command);
  }
  return JSON.stringify(payload);
}

function copyCreateCommandFields(payload: CreateApplicationCommand, body: CreateApplicationCommand): void {
  if ("description" in body) {
    payload.description = body.description;
  }
  if ("type" in body) {
    payload.type = body.type;
  }
  if ("options" in body && body.options !== undefined) {
    payload.options = encodeOptions(body.options);
  }
  if ("default_member_permissions" in body) {
    payload.default_member_permissions = body.default_member_permissions;
  }
  if ("nsfw" in body) {
    payload.nsfw = body.nsfw;
  }
}

function encodeOptions(options: ApplicationCommandOption[]): ApplicationCommandOption[] {
  const encoded: ApplicationCommandOption[] = [];
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === undefined) {
      continue;
    }
    const copy: ApplicationCommandOption = {
      type: option.type,
      name: option.name,
      description: option.description,
    };
    if ("required" in option) {
      copy.required = option.required;
    }
    if ("options" in option && option.options !== undefined) {
      copy.options = encodeOptions(option.options);
    }
    encoded.push(copy);
  }
  return encoded;
}

function decodeOptions(value: unknown, field: string): ApplicationCommandOption[] {
  if (!Array.isArray(value)) {
    throw new DecodeError(`${field} must be an array`);
  }
  const options: ApplicationCommandOption[] = [];
  for (let index = 0; index < value.length; index += 1) {
    options.push(decodeOption(value[index], `${field}[${index}]`));
  }
  return options;
}

function decodeOption(value: unknown, field: string): ApplicationCommandOption {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError(`${field} must be an object`);
  }
  if (!("type" in value) || !("name" in value) || !("description" in value)) {
    throw new DecodeError(`${field} is missing required fields`);
  }
  const type = value.type;
  const name = value.name;
  const description = value.description;
  if (typeof type !== "number" || typeof name !== "string" || typeof description !== "string") {
    throw new DecodeError(`${field} type must be a number and name and description strings`);
  }
  const option: ApplicationCommandOption = { type, name, description };
  if ("required" in value) {
    const required = value.required;
    if (typeof required !== "boolean") {
      throw new DecodeError(`${field}.required must be a boolean`);
    }
    option.required = required;
  }
  if ("options" in value) {
    option.options = decodeOptions(value.options, `${field}.options`);
  }
  return option;
}

function decodeApplicationCommandPermission(value: unknown, index: number): ApplicationCommandPermission {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DecodeError(`Application Command Permissions.permissions[${index}] must be an object`);
  }
  if (!("id" in value) || !("type" in value) || !("permission" in value)) {
    throw new DecodeError(`Application Command Permissions.permissions[${index}] is missing required fields`);
  }
  const type = value.type;
  const permission = value.permission;
  if (typeof type !== "number" || typeof permission !== "boolean") {
    throw new DecodeError(
      `Application Command Permissions.permissions[${index}] type must be a number and permission a boolean`,
    );
  }
  return {
    id: decodeSnowflake(value.id, `Application Command Permissions.permissions[${index}].id`),
    type,
    permission,
  };
}
