import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestClient } from "moon-discord/testing";
import type { RestHttp, RestHttpRequest } from "moon-discord/testing";

function createClientWithHttp(http: RestHttp) {
  return createTestClient(
    { token: "bot-token" },
    {
      http,
      clock: {
        nowMs: () => 0,
        schedule: () => () => {},
      },
    },
  );
}

function currentApplicationBody(): string {
  return JSON.stringify({
    id: "613425648685547541",
    name: "test",
    flags: 0,
    extra: "drop-me",
  });
}

function exampleCommandJson(): string {
  return JSON.stringify({
    id: "1107321043549765632",
    type: 1,
    application_id: "613425648685547541",
    name: "blep",
    description: "Send a random adorable animal photo",
    default_member_permissions: null,
    version: "1107321043549765633",
    options: [{ type: 3, name: "animal", description: "The type of animal", extra: true }],
    extra: "drop-me",
  });
}

test("createGlobalApplicationCommand lazy-GETs application.id then POSTs the command", async () => {
  const requests: RestHttpRequest[] = [];
  const client = createClientWithHttp({
    request: async (request) => {
      requests.push(request);
      if (request.url === "https://discord.com/api/v10/applications/@me") {
        return { status: 200, headers: {}, body: currentApplicationBody() };
      }
      return { status: 201, headers: {}, body: exampleCommandJson() };
    },
  });
  const command = await client.rest.createGlobalApplicationCommand({
    name: "blep",
    description: "Send a random adorable animal photo",
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.method, "GET");
  assert.equal(requests[0]?.url, "https://discord.com/api/v10/applications/@me");
  assert.equal(requests[0]?.headers["Authorization"], "Bot bot-token");
  assert.equal(requests[1]?.method, "POST");
  assert.equal(
    requests[1]?.url,
    "https://discord.com/api/v10/applications/613425648685547541/commands",
  );
  assert.equal(requests[1]?.headers["Content-Type"], "application/json");
  assert.equal(
    requests[1]?.body,
    '{"name":"blep","description":"Send a random adorable animal photo"}',
  );
  assert.equal(command.id, "1107321043549765632");
  assert.equal(command.application_id, "613425648685547541");
  assert.equal(command.name, "blep");
  assert.equal(command.description, "Send a random adorable animal photo");
  assert.equal(command.default_member_permissions, null);
  assert.equal(command.version, "1107321043549765633");
  assert.equal(command.options?.[0]?.name, "animal");
  assert.equal(command.options !== undefined && "extra" in (command.options[0] ?? {}), false);
  assert.equal("extra" in command, false);
});

test("global command CRUD uses application.id after the first lazy GET", async () => {
  const requests: RestHttpRequest[] = [];
  const client = createClientWithHttp({
    request: async (request) => {
      requests.push(request);
      if (request.url.endsWith("/applications/@me")) {
        return { status: 200, headers: {}, body: currentApplicationBody() };
      }
      if (request.method === "DELETE") {
        return { status: 204, headers: {}, body: "" };
      }
      if (request.url.endsWith("/commands") && (request.method === "GET" || request.method === "PUT")) {
        return { status: 200, headers: {}, body: `[${exampleCommandJson()}]` };
      }
      return { status: 200, headers: {}, body: exampleCommandJson() };
    },
  });
  const listed = await client.rest.getGlobalApplicationCommands();
  const one = await client.rest.getGlobalApplicationCommand("1107321043549765632");
  const edited = await client.rest.editGlobalApplicationCommand("1107321043549765632", { name: "blep2" });
  const deleted = await client.rest.deleteGlobalApplicationCommand("1107321043549765632");
  const overwritten = await client.rest.bulkOverwriteGlobalApplicationCommands([{ name: "blep" }]);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.name, "blep");
  assert.equal(one.id, "1107321043549765632");
  assert.equal(edited.name, "blep");
  assert.equal(deleted, undefined);
  assert.equal(overwritten.length, 1);
  assert.equal(requests[0]?.url, "https://discord.com/api/v10/applications/@me");
  assert.equal(requests[1]?.method, "GET");
  assert.equal(requests[1]?.url, "https://discord.com/api/v10/applications/613425648685547541/commands");
  assert.equal(
    requests[2]?.url,
    "https://discord.com/api/v10/applications/613425648685547541/commands/1107321043549765632",
  );
  assert.equal(requests[3]?.method, "PATCH");
  assert.equal(requests[3]?.body, '{"name":"blep2"}');
  assert.equal(requests[4]?.method, "DELETE");
  assert.equal(requests[5]?.method, "PUT");
  assert.equal(requests[5]?.body, '[{"name":"blep"}]');
  const meGets = requests.filter((request) => request.url.endsWith("/applications/@me"));
  assert.equal(meGets.length, 1);
});

test("guild command CRUD and Bot-token permission GETs omit Edit Application Command Permissions", async () => {
  const requests: RestHttpRequest[] = [];
  const client = createClientWithHttp({
    request: async (request) => {
      requests.push(request);
      if (request.url.endsWith("/applications/@me")) {
        return { status: 200, headers: {}, body: currentApplicationBody() };
      }
      if (request.method === "DELETE") {
        return { status: 204, headers: {}, body: "" };
      }
      if (request.method === "PUT") {
        return { status: 200, headers: {}, body: `[${exampleCommandJson()}]` };
      }
      if (request.url.endsWith("/permissions") && request.url.includes("/commands/")) {
        if (request.url.endsWith("/commands/permissions")) {
          return {
            status: 200,
            headers: {},
            body: JSON.stringify([
              {
                id: "1107321043549765632",
                application_id: "613425648685547541",
                guild_id: "41771983423143937",
                permissions: [{ id: "1", type: 1, permission: true, extra: true }],
                extra: true,
              },
            ]),
          };
        }
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            id: "1107321043549765632",
            application_id: "613425648685547541",
            guild_id: "41771983423143937",
            permissions: [{ id: "1", type: 1, permission: true }],
          }),
        };
      }
      if (request.url.endsWith("/commands") && (request.method === "GET" || request.method === "PUT")) {
        return { status: 200, headers: {}, body: `[${exampleCommandJson()}]` };
      }
      return { status: 200, headers: {}, body: exampleCommandJson() };
    },
  });
  await client.rest.createGuildApplicationCommand("41771983423143937", { name: "blep", description: "x" });
  await client.rest.getGuildApplicationCommands("41771983423143937");
  await client.rest.getGuildApplicationCommand("41771983423143937", "1107321043549765632");
  await client.rest.editGuildApplicationCommand("41771983423143937", "1107321043549765632", { description: "y" });
  await client.rest.deleteGuildApplicationCommand("41771983423143937", "1107321043549765632");
  await client.rest.bulkOverwriteGuildApplicationCommands("41771983423143937", [{ name: "blep" }]);
  const allPermissions = await client.rest.getGuildApplicationCommandPermissions("41771983423143937");
  const onePermission = await client.rest.getApplicationCommandPermissions(
    "41771983423143937",
    "1107321043549765632",
  );
  assert.equal(allPermissions[0]?.permissions[0]?.permission, true);
  assert.equal(allPermissions[0] !== undefined && "extra" in allPermissions[0], false);
  assert.equal(onePermission.guild_id, "41771983423143937");
  assert.equal(
    requests[1]?.url,
    "https://discord.com/api/v10/applications/613425648685547541/guilds/41771983423143937/commands",
  );
  assert.equal(requests[1]?.method, "POST");
  const putPermissions = requests.filter(
    (request) => request.method === "PUT" && request.url.endsWith("/permissions"),
  );
  assert.equal(putPermissions.length, 0);
  assert.equal("editApplicationCommandPermissions" in client.rest, false);
});
