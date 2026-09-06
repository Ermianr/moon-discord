import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CancelledError,
  ConfigurationError,
  DecodeError,
  DiscordHttpError,
  GatewayFatalError,
  MoonDiscordError,
  SaturatedError,
  TransportError,
} from "moon-discord";
import * as rest from "moon-discord/rest";

test("MoonDiscordError subclasses set error.name to the class name", () => {
  assert.equal(new MoonDiscordError("x").name, "MoonDiscordError");
  assert.equal(new ConfigurationError("x").name, "ConfigurationError");
  assert.equal(new DecodeError("x").name, "DecodeError");
  assert.equal(new CancelledError("x").name, "CancelledError");
  assert.equal(new TransportError("x").name, "TransportError");
  assert.equal(new DiscordHttpError({ status: 400, code: 0, message: "HTTP 400" }).name, "DiscordHttpError");
  assert.equal(new SaturatedError({ kind: "rest_wait" }).name, "SaturatedError");
  assert.equal(new GatewayFatalError({ closeCode: 4004 }).name, "GatewayFatalError");
  assert.ok(new ConfigurationError("x") instanceof MoonDiscordError);
});

test("moon-discord/rest exports the same MoonDiscordError subclasses", () => {
  assert.equal(rest.ConfigurationError, ConfigurationError);
  assert.equal(rest.MoonDiscordError, MoonDiscordError);
  assert.equal(rest.DiscordHttpError, DiscordHttpError);
  assert.equal(rest.DecodeError, DecodeError);
  assert.equal(rest.CancelledError, CancelledError);
  assert.equal(rest.SaturatedError, SaturatedError);
  assert.equal(rest.TransportError, TransportError);
  assert.equal(rest.GatewayFatalError, GatewayFatalError);
});

test("moon-discord/rest exports the same wait constants", () => {
  assert.equal(rest.REST_MAX_WAIT_MS, 600_000);
  assert.equal(rest.HTTP_5XX_RETRY_MS, 1_000);
  assert.equal(rest.GATEWAY_SEND_QUEUE, 120);
  assert.equal(rest.GATEWAY_SESSION_WAIT_MS, 60_000);
});
