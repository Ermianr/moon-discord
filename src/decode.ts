import { DecodeError } from "./errors.js";

export type GetGateway = {
  url: string;
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
