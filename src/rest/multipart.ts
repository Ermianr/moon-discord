import { randomBytes } from "node:crypto";
import { ConfigurationError } from "../errors.js";

export type OutboundFile = {
  filename: string;
  bytes: Uint8Array;
  contentType?: string;
};

const BOUNDARY_ATTEMPTS = 8;
const CRLF = "\r\n";

export type EncodedMultipart = {
  contentType: string;
  body: Uint8Array;
};

export type MultipartPart = {
  name: string;
  filename?: string;
  contentType?: string;
  body: Uint8Array;
};

export function encodePayloadJsonFiles(jsonText: string, files: OutboundFile[]): EncodedMultipart {
  const parts: MultipartPart[] = [
    {
      name: "payload_json",
      contentType: "application/json",
      body: utf8(jsonText),
    },
  ];
  for (let index = 0; index < files.length; index += 1) {
    const name = `files[${decimal(index)}]`;
    parts.push(filePart(name, files[index], name));
  }
  return encodeMultipart(parts);
}

export function encodeNamedForm(parts: MultipartPart[]): EncodedMultipart {
  return encodeMultipart(parts);
}

export function filePart(name: string, file: OutboundFile | undefined, label: string): MultipartPart {
  if (file === undefined) {
    throw new ConfigurationError(`${label} is required`);
  }
  if (!("filename" in file) || file.filename === "") {
    throw new ConfigurationError(`${label} is missing filename`);
  }
  if (!("bytes" in file) || file.bytes === undefined) {
    throw new ConfigurationError(`${label} is missing bytes`);
  }
  const part: MultipartPart = {
    name,
    filename: file.filename,
    body: file.bytes,
  };
  if ("contentType" in file && file.contentType !== undefined) {
    part.contentType = file.contentType;
  }
  return part;
}

function encodeMultipart(parts: MultipartPart[]): EncodedMultipart {
  const encoder = new TextEncoder();
  for (let attempt = 0; attempt < BOUNDARY_ATTEMPTS; attempt += 1) {
    const boundary = makeBoundary();
    const boundaryBytes = encoder.encode(boundary);
    let collision = false;
    const chunks: Uint8Array[] = [];
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (part === undefined) {
        continue;
      }
      const header = partHeader(part);
      const headerBytes = encoder.encode(header);
      if (containsBytes(headerBytes, boundaryBytes) || containsBytes(part.body, boundaryBytes)) {
        collision = true;
        break;
      }
      chunks.push(encoder.encode(`--${boundary}${CRLF}`));
      chunks.push(headerBytes);
      chunks.push(part.body);
      chunks.push(encoder.encode(CRLF));
    }
    if (collision) {
      continue;
    }
    chunks.push(encoder.encode(`--${boundary}--${CRLF}`));
    return {
      contentType: `multipart/form-data; boundary=${boundary}`,
      body: concat(chunks),
    };
  }
  throw new ConfigurationError("multipart boundary could not be allocated");
}

function partHeader(part: MultipartPart): string {
  let disposition = `Content-Disposition: form-data; name="${escapeQuoted(part.name)}"`;
  if ("filename" in part && part.filename !== undefined) {
    disposition += `; filename="${escapeQuoted(part.filename)}"`;
  }
  let header = `${disposition}${CRLF}`;
  if ("contentType" in part && part.contentType !== undefined) {
    header += `Content-Type: ${part.contentType}${CRLF}`;
  }
  return `${header}${CRLF}`;
}

function makeBoundary(): string {
  const bytes = randomBytes(16);
  let hex = "";
  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index];
    if (value === undefined) {
      continue;
    }
    hex += hexByte(value);
  }
  return `----moon${hex}`;
}

function hexByte(value: number): string {
  return hexDigit((value >> 4) & 15) + hexDigit(value & 15);
}

function hexDigit(value: number): string {
  if (value < 10) {
    return String.fromCharCode(48 + value);
  }
  return String.fromCharCode(87 + value);
}

function decimal(value: number): string {
  if (value === 0) {
    return "0";
  }
  let remaining = value;
  let out = "";
  while (remaining > 0) {
    const digit = remaining % 10;
    out = String.fromCharCode(48 + digit) + out;
    remaining = (remaining - digit) / 10;
  }
  return out;
}

function escapeQuoted(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const ch = value.charAt(index);
    if (ch === "\\") {
      out += "\\\\";
    } else if (ch === '"') {
      out += '\\"';
    } else if (ch !== undefined) {
      out += ch;
    }
  }
  return out;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (chunk === undefined) {
      continue;
    }
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (chunk === undefined) {
      continue;
    }
    for (let byteIndex = 0; byteIndex < chunk.length; byteIndex += 1) {
      out[offset] = chunk[byteIndex] ?? 0;
      offset += 1;
    }
  }
  return out;
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || haystack.length < needle.length) {
    return false;
  }
  const limit = haystack.length - needle.length;
  for (let start = 0; start <= limit; start += 1) {
    let matched = true;
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[start + index] !== needle[index]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }
  return false;
}
