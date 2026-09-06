import { Client } from "moon-discord";

declare const client: Client;

void client.rest.createGlobalApplicationCommand;
void client.rest.getGuildApplicationCommandPermissions;

// @ts-expect-error Edit Application Command Permissions is Bearer-only and has no typed method
void client.rest.editApplicationCommandPermissions;
