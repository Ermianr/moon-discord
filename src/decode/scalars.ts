import { DecodeError } from "../errors.js";

export type Snowflake = string;
export type Timestamp = string;

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
