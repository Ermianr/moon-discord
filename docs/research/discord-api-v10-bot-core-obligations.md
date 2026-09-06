# Discord API v10 bot-core obligations

**Issue:** [moon-discord #3](https://github.com/Ermianr/moon-discord/issues/3)  
**Research date:** 2026-09-05  
**Pinned API:** HTTP `https://discord.com/api/v10`; Gateway `wss://gateway.discord.gg/?v=10&encoding=json`  
**Auth model:** Bot tokens only (`Authorization: Bot <token>`)

## Decision / scope

This note inventories the **official Discord API v10 surface a bot library 1.0 bot-core must implement**: REST (typed semantic methods), Gateway lifecycle, dispatch events, interaction transports, rate limits, intents, sharding, protocol limits, and error/opcode/close-code handling.

| In 1.0 bot-core | Not a 1.0 bot-core obligation |
| --- | --- |
| REST over API v10 with Bot token, User-Agent, JSON and documented multipart uploads | Discord Voice protocol (voice WebSocket opcodes, UDP, DAVE/MLS, voice close codes as a Voice client) |
| Gateway JSON encoding, session lifecycle, reconnection, resume, sharding | User tokens / selfbots |
| Dispatch events a guild bot receives, including guild-Gateway voice events (`VOICE_STATE_UPDATE`, `VOICE_SERVER_UPDATE`, opcode 4 Update Voice State) | Mandatory cache (Discord *recommends* caching; it is not a protocol requirement) |
| Interactions: Gateway `INTERACTION_CREATE`; HTTP callback/followups; optional HTTP Interactions Endpoint URL as Discord’s mutually exclusive receive mode | WASI, runtime npm / `--dynamic` |
| HTTP and Gateway rate limits, invalid-request tracking | General-purpose OAuth2 authorization-code / implicit client for user apps |
| Intents (required on v8+) and privileged-intent HTTP restrictions | discord.js API parity |
| Get Gateway / Get Gateway Bot | Social SDK, Activities Embedded App SDK, RPC, Certified Devices, Game Stats Widgets / Application Identity Profile as a product feature |
| | Lobby HTTP as a Social Layer product (bot *can* call some lobby routes; not promised as 1.0 bot-core) |
| | Outgoing webhook *events* (`APPLICATION_AUTHORIZED`, etc.) as a required Gateway substitute |

Webhook Events and HTTP Interactions are official transports. The applicable bot-core surface **includes** Gateway `INTERACTION_CREATE` plus HTTP callback/followup routes (Gateway bots still answer over HTTP). Discord also documents an HTTP Interactions Endpoint URL as a **mutually exclusive** receive mode (Ed25519, 3s ACK). That receive mode is part of Discord’s interaction protocol, not a separate product. Whether both receive modes ship in the first `0.x` cut or only at `1.0` is a milestone decision ([Define 1.0 completeness and pre-1.0 milestones](https://github.com/Ermianr/moon-discord/issues/5)), not a Discord omission. Outgoing Webhook Events are **not** a Gateway substitute and are **not** a 1.0 Gateway obligation; they are a small HTTP event set Discord says is not realtime and not ordered.[S8][S9][S6]

**HTTP verb note:** Official resource pages name operations and paths. The fetched markdown often omits `GET`/`POST`/`PATCH`/`PUT`/`DELETE` in headings. Verbs below follow Discord’s conventional mapping (Get/List → GET, Create → POST, Modify/Edit → PATCH, Delete → DELETE, Bulk Overwrite / Add Member → PUT) unless the page states otherwise. Where the page did not name the verb, treat the verb as **SOURCE-CONVENTION**, not a separately quoted sentence.

## Evidence labels

| Label | Meaning |
| --- | --- |
| **SOURCE** | Stated on official Discord developer docs fetched 2026-09-05. |
| **SOURCE-CONVENTION** | Path and operation name are official; HTTP verb inferred from Discord’s usual mapping. |
| **UNVERIFIED** | Not found on the official pages fetched for this note. Do not invent. |

---

## 1. REST resources and operations

### 1.1 Transport, versioning, auth, User-Agent

- Base URL: `https://discord.com/api`; version in path: `https://discord.com/api/v{version_number}`. **v10 is Available.** Omitting the version routes to Discord’s current default. Discontinued versions return **400 Bad Request**.[S1]
- TLS 1.2 on all HTTP-layer services and WebSocket.[S1]
- Auth: `Authorization: TOKEN_TYPE TOKEN`. Bot example: `Authorization: Bot <token>`. Bearer OAuth2 tokens exist; **bot-core uses Bot tokens**. Self-bots are forbidden by Discord’s ToS statement on the OAuth2 page.[S1][S10]
- **User-Agent is mandatory:** `User-Agent: DiscordBot ($url, $versionNumber)` plus optional trailing metadata. Missing/invalid User-Agent may be blocked with a Cloudflare error; JSON error **40333** is “Cloudflare is blocking your request… setting a proper User Agent”.[S1][S4]
- **Content-Type:** `application/json`, `application/x-www-form-urlencoded`, or `multipart/form-data` except where specified. Failure → JSON **50035** Invalid form body.[S1]
- Boolean query strings: `True`/`true`/`1` and `False`/`false`/`0`. Array query strings: repeated keys `?id=123&id=456` unless an endpoint says otherwise.[S1]
- Snowflakes are **strings** in HTTP JSON (up to 64-bit). Discord Epoch `1420070400000`. Pagination commonly uses `before`/`after`/`limit`. Sending non-bigint IDs can come back as JSON numbers.[S1]
- ISO8601 timestamps; nullable fields `?type`; optional fields `name?`.[S1]
- Eventual consistency: events may be never sent, once, or N times; clients should be idempotent.[S1]
- Audit reason: `X-Audit-Log-Reason` header, 1–512 URL-encoded UTF-8 characters, on many mutating routes.[S11]

**Bot-token REST that is in 1.0:** Get Gateway (unauthenticated) and Get Gateway Bot (bot token).[S2]

| Operation | Method | Path | Auth | Notes |
| --- | --- | --- | --- | --- |
| Get Gateway | GET | `/gateway` | None | Returns `{ url }`. Cache `url`; call again only if connect fails.[S2] |
| Get Gateway Bot | GET | `/gateway/bot` | Bot | `{ url, shards, session_start_limit }`. Do not cache for long; values change with guild join/leave.[S2] |
| Get Current Bot Application Information | GET | `/oauth2/applications/@me` | Bot | Returns the bot’s application object.[S10] Prefer also exposing Get Current Application (`/applications/@me`).[S12] |

### 1.2 Multipart / file uploads (library obligation)

Endpoints that document `files[n]` replace JSON with `multipart/form-data`. Optional JSON in `payload_json`. Each file: `Content-Disposition` with `filename` and unique `name` `files[0]`, `files[1]`, … Index `n` is the snowflake placeholder for `attachments`. Embeds may use `attachment://filename`. Default per-file cap **20 MiB** (may be higher via Nitro / Boost; interaction `attachment_size_limit` is the max of those). Editing: `attachments` is the keep-list; v10 requires the array to contain all attachments that should remain.[S1][S16]

**In 1.0:** typed methods must accept this body shape on Create/Edit Message, Execute/Edit Webhook, Create Interaction Response, and other routes that document `files[n]`. How the engine encodes multipart is a runtime concern, not a Discord-API cut.

### 1.3 Interaction callback routes vs ordinary REST

Interaction HTTP is webhook-shaped and **not bound to the application’s Global Rate Limit** (50 rps). Followup routes use `/webhooks/{application.id}/{interaction.token}/…` with the interaction token, not a webhook token. Gateway-received interactions **must** be answered via HTTP, not Gateway send.[S6][S3]

See §4 for the full interaction route list.

### 1.4 OAuth2 authorization-code (out of 1.0)

Authorization Code Grant, Implicit Grant, Client Credentials, user `identify`/`email`/`guilds` flows, and a general OAuth2 client are **not** 1.0 bot-core. Bots are added via the bot install URL (`scope` including `bot`). Edit Application Command Permissions **requires a Bearer token** with guild-manage permission — that is a documented exception; a Bot token is not sufficient for that one route.[S10][S17]

User-resource routes that **require user OAuth2 scopes** (connections, role-connection write, `guilds.members.read` on `/users/@me/guilds/{guild.id}/member`, Create Group DM with `gdm.join` tokens) are **not** bot-core 1.0 obligations. Bot-applicable user routes (Get Current User as the bot user, Get User, Modify Current User for the bot profile, Get Current User Guilds, Leave Guild, Create DM) **are** in 1.0.[S18]

### 1.5 Application

| Operation | Method | Path | Notes |
| --- | --- | --- | --- |
| Get Current Application | GET | `/applications/@me` | Bot’s application object.[S12] |
| Edit Current Application | PATCH | `/applications/@me` | Optional JSON; `flags` only limited intent flags; `interactions_endpoint_url` must be valid per interaction docs.[S12] |
| Get Application Activity Instance | GET | `/applications/{application.id}/activity-instances/{instance_id}` | Activities; **optional / not core guild-bot 1.0** unless Activities are in product scope.[S12] |

### 1.6 Application commands

| Operation | Method | Path | Notes |
| --- | --- | --- | --- |
| Get Global Application Commands | GET | `/applications/{application.id}/commands` | |
| Create Global Application Command | POST | `/applications/{application.id}/commands` | |
| Get Global Application Command | GET | `/applications/{application.id}/commands/{command.id}` | |
| Edit Global Application Command | PATCH | `/applications/{application.id}/commands/{command.id}` | |
| Delete Global Application Command | DELETE | `/applications/{application.id}/commands/{command.id}` | |
| Bulk Overwrite Global Application Commands | PUT | `/applications/{application.id}/commands` | |
| Get Guild Application Commands | GET | `/applications/{application.id}/guilds/{guild.id}/commands` | |
| Create Guild Application Command | POST | `/applications/{application.id}/guilds/{guild.id}/commands` | |
| Get Guild Application Command | GET | `/applications/{application.id}/guilds/{guild.id}/commands/{command.id}` | |
| Edit Guild Application Command | PATCH | `/applications/{application.id}/guilds/{guild.id}/commands/{command.id}` | |
| Delete Guild Application Command | DELETE | `/applications/{application.id}/guilds/{guild.id}/commands/{command.id}` | |
| Bulk Overwrite Guild Application Commands | PUT | `/applications/{application.id}/guilds/{guild.id}/commands` | |
| Get Guild Application Command Permissions | GET | `/applications/{application.id}/guilds/{guild.id}/commands/permissions` | |
| Get Application Command Permissions | GET | `/applications/{application.id}/guilds/{guild.id}/commands/{command.id}/permissions` | |
| Edit Application Command Permissions | PUT | `/applications/{application.id}/guilds/{guild.id}/commands/{command.id}/permissions` | **Bearer token**, not Bot; max 100 overwrites.[S17] |
| Batch Edit Application Command Permissions | — | `/applications/{application.id}/guilds/{guild.id}/commands/permissions` | **Disabled** (Permissions v2). Do not implement as a live route.[S17] |

### 1.7 Application role connection metadata (bot token)

| Operation | Method | Path | Notes |
| --- | --- | --- | --- |
| Get Application Role Connection Metadata Records | GET | `/applications/{application.id}/role-connections/metadata` | Max 5 records on update.[S19] |
| Update Application Role Connection Metadata Records | PUT | `/applications/{application.id}/role-connections/metadata` | |

User role-connection **read/write** under `/users/@me/applications/{application.id}/role-connection` requires OAuth2 `role_connections.write` — **out of bot-core 1.0**.[S18]

### 1.8 Application emojis

| Operation | Method | Path |
| --- | --- | --- |
| List Application Emojis | GET | `/applications/{application.id}/emojis` |
| Get Application Emoji | GET | `/applications/{application.id}/emojis/{emoji.id}` |
| Create Application Emoji | POST | `/applications/{application.id}/emojis` |
| Modify Application Emoji | PATCH | `/applications/{application.id}/emojis/{emoji.id}` |
| Delete Application Emoji | DELETE | `/applications/{application.id}/emojis/{emoji.id}` |

App may own up to **2000** emojis; upload via image data; **256 KiB** file cap. `USE_EXTERNAL_EMOJIS` not required to use app emojis.[S20]

### 1.9 Entitlements / SKUs / subscriptions (bot-token monetization REST)

In 1.0 **if** the library exposes premium-app REST; otherwise a documented **later-cut** (still official bot-token routes):

| Operation | Method | Path |
| --- | --- | --- |
| List Entitlements | GET | `/applications/{application.id}/entitlements` |
| Get Entitlement | GET | `/applications/{application.id}/entitlements/{entitlement.id}` |
| Consume an Entitlement | POST | `/applications/{application.id}/entitlements/{entitlement.id}/consume` |
| Create Test Entitlement | POST | `/applications/{application.id}/entitlements` |
| Delete Test Entitlement | DELETE | `/applications/{application.id}/entitlements/{entitlement.id}` |
| List SKUs | GET | `/applications/{application.id}/skus` |
| List SKU Subscriptions | GET | `/skus/{sku.id}/subscriptions` |
| Get SKU Subscription | GET | `/skus/{sku.id}/subscriptions/{subscription.id}` |

[S21][S22][S23]

### 1.10 Audit log

| Operation | Method | Path | Notes |
| --- | --- | --- | --- |
| Get Guild Audit Log | GET | `/guilds/{guild.id}/audit-logs` | Requires `VIEW_AUDIT_LOG`. Query: `user_id`, `action_type`, `before`, `after`, `limit` 1–100 default 50. Entries stored 45 days.[S11] |

### 1.11 Auto Moderation

Requires `MANAGE_GUILD` (TIMEOUT action also `MODERATE_MEMBERS`).[S24]

| Operation | Method | Path |
| --- | --- | --- |
| List Auto Moderation Rules for Guild | GET | `/guilds/{guild.id}/auto-moderation/rules` |
| Get Auto Moderation Rule | GET | `/guilds/{guild.id}/auto-moderation/rules/{auto_moderation_rule.id}` |
| Create Auto Moderation Rule | POST | `/guilds/{guild.id}/auto-moderation/rules` |
| Modify Auto Moderation Rule | PATCH | `/guilds/{guild.id}/auto-moderation/rules/{auto_moderation_rule.id}` |
| Delete Auto Moderation Rule | DELETE | `/guilds/{guild.id}/auto-moderation/rules/{auto_moderation_rule.id}` |

### 1.12 Channel (including threads as channels)

| Operation | Method | Path | Notes |
| --- | --- | --- | --- |
| Get Channel | GET | `/channels/{channel.id}` | Thread includes thread member.[S25] |
| Modify Channel | PATCH | `/channels/{channel.id}` | Guild / Group DM / Thread param sets.[S25] |
| Set Voice Channel Status | PUT or PATCH **UNVERIFIED verb** | `/channels/{channel.id}/voice-status` | Status up to 500 chars; `SET_VOICE_CHANNEL_STATUS`.[S25] |
| Delete/Close Channel | DELETE | `/channels/{channel.id}` | |
| Edit Channel Permissions | PUT | `/channels/{channel.id}/permissions/{overwrite.id}` | |
| Get Channel Invites | GET | `/channels/{channel.id}/invites` | |
| Create Channel Invite | POST | `/channels/{channel.id}/invites` | |
| Delete Channel Permission | DELETE | `/channels/{channel.id}/permissions/{overwrite.id}` | |
| Follow Announcement Channel | POST | `/channels/{channel.id}/followers` | |
| Trigger Typing Indicator | POST | `/channels/{channel.id}/typing` | |
| Group DM Add Recipient | PUT | `/channels/{channel.id}/recipients/{user.id}` | Bots cannot join Group DMs via OAuth2 bot rules; route exists for Group DM channels.[S10][S25] |
| Group DM Remove Recipient | DELETE | `/channels/{channel.id}/recipients/{user.id}` | |
| Start Thread from Message | POST | `/channels/{channel.id}/messages/{message.id}/threads` | |
| Start Thread without Message | POST | `/channels/{channel.id}/threads` | |
| Start Thread in Forum or Media Channel | POST | `/channels/{channel.id}/threads` | Multipart message+thread.[S25][S26] |
| Join Thread | PUT | `/channels/{channel.id}/thread-members/@me` | |
| Add Thread Member | PUT | `/channels/{channel.id}/thread-members/{user.id}` | |
| Leave Thread | DELETE | `/channels/{channel.id}/thread-members/@me` | |
| Remove Thread Member | DELETE | `/channels/{channel.id}/thread-members/{user.id}` | |
| Get Thread Member | GET | `/channels/{channel.id}/thread-members/{user.id}` | |
| List Thread Members | GET | `/channels/{channel.id}/thread-members` | |
| List Public Archived Threads | GET | `/channels/{channel.id}/threads/archived/public` | |
| List Private Archived Threads | GET | `/channels/{channel.id}/threads/archived/private` | |
| List Joined Private Archived Threads | GET | `/channels/{channel.id}/users/@me/threads/archived/private` | |

Threads: v9+ required for thread Gateway events. Editing/deleting threads uses Modify/Delete Channel.[S26]

### 1.13 Message

| Operation | Method | Path | Notes |
| --- | --- | --- | --- |
| Get Channel Messages | GET | `/channels/{channel.id}/messages` | |
| Search Guild Messages | GET | `/guilds/{guild.id}/messages/search` | |
| Get Channel Message | GET | `/channels/{channel.id}/messages/{message.id}` | |
| Create Message | POST | `/channels/{channel.id}/messages` | JSON or multipart `files[n]`.[S16] |
| Crosspost Message | POST | `/channels/{channel.id}/messages/{message.id}/crosspost` | |
| Create Reaction | PUT | `/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me` | Path in docs uses `{emoji.id}`; Unicode emoji encoding **UNVERIFIED** in the fetched path string — official page uses an `{emoji}`-style parameter in practice historically; implement per live docs examples. |
| Delete Own Reaction | DELETE | `/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me` | |
| Delete User Reaction | DELETE | `/channels/{channel.id}/messages/{message.id}/reactions/{emoji}/{user.id}` | |
| Get Reactions | GET | `/channels/{channel.id}/messages/{message.id}/reactions/{emoji}` | |
| Delete All Reactions | DELETE | `/channels/{channel.id}/messages/{message.id}/reactions` | |
| Delete All Reactions for Emoji | DELETE | `/channels/{channel.id}/messages/{message.id}/reactions/{emoji}` | |
| Edit Message | PATCH | `/channels/{channel.id}/messages/{message.id}` | Multipart supported.[S16] |
| Delete Message | DELETE | `/channels/{channel.id}/messages/{message.id}` | |
| Bulk Delete Messages | POST | `/channels/{channel.id}/messages/bulk-delete` | 2–99 messages; not older than 14 days (JSON 50016/50034).[S4][S16] |
| Get Channel Pins | GET | `/channels/{channel.id}/messages/pins` | Current pins route.[S16] |
| Pin Message | PUT | `/channels/{channel.id}/messages/pins/{message.id}` | |
| Unpin Message | DELETE | `/channels/{channel.id}/messages/pins/{message.id}` | |
| Get Pinned Messages (deprecated) | GET | `/channels/{channel.id}/pins` | |
| Pin Message (deprecated) | PUT | `/channels/{channel.id}/pins/{message.id}` | |
| Unpin Message (deprecated) | DELETE | `/channels/{channel.id}/pins/{message.id}` | |

Reaction path placeholder: official message page shows `/reactions/{emoji.id}/@me`. Unicode reactions historically use URL-encoded `name` instead of an id. Exact encoding rule for Unicode on v10: treat as **follow the live examples on that page**; do not invent a second scheme.[S16]

### 1.14 Poll

Create via Create Message. Apps **cannot vote**. After creation, poll message cannot be edited.[S27]

| Operation | Method | Path |
| --- | --- | --- |
| Get Answer Voters | GET | `/channels/{channel.id}/polls/{message.id}/answers/{answer_id}` |
| End Poll | POST | `/channels/{channel.id}/polls/{message.id}/expire` |

### 1.15 Emoji (guild) — abnormal rate limits

Emoji routes **do not follow normal rate-limit conventions**; per-guild; header quota may be inaccurate; 429s expected.[S3][S20]

| Operation | Method | Path |
| --- | --- | --- |
| List Guild Emojis | GET | `/guilds/{guild.id}/emojis` |
| Get Guild Emoji | GET | `/guilds/{guild.id}/emojis/{emoji.id}` |
| Create Guild Emoji | POST | `/guilds/{guild.id}/emojis` |
| Modify Guild Emoji | PATCH | `/guilds/{guild.id}/emojis/{emoji.id}` |
| Delete Guild Emoji | DELETE | `/guilds/{guild.id}/emojis/{emoji.id}` |

### 1.16 Sticker

| Operation | Method | Path | Notes |
| --- | --- | --- | --- |
| Get Sticker | GET | `/stickers/{sticker.id}` | |
| List Sticker Packs | GET | `/sticker-packs` | |
| Get Sticker Pack | GET | `/sticker-packs/{pack.id}` | |
| List Guild Stickers | GET | `/guilds/{guild.id}/stickers` | |
| Get Guild Sticker | GET | `/guilds/{guild.id}/stickers/{sticker.id}` | |
| Create Guild Sticker | POST | `/guilds/{guild.id}/stickers` | **multipart/form-data**; max 512 KiB; Lottie only VERIFIED/PARTNERED.[S28] |
| Modify Guild Sticker | PATCH | `/guilds/{guild.id}/stickers/{sticker.id}` | |
| Delete Guild Sticker | DELETE | `/guilds/{guild.id}/stickers/{sticker.id}` | |

### 1.17 Guild

**Create Guild / Delete Guild / Create Guild from Template:** not present on the Guild Resource or Guild Template Resource pages fetched 2026-09-05. Treat existence as **UNVERIFIED** for v10 bot-core until Discord republishes them. Do not promise `POST /guilds` as a 1.0 obligation from this inventory.[S13][S29]

| Operation | Method | Path | Notes |
| --- | --- | --- | --- |
| Get Guild | GET | `/guilds/{guild.id}` | `with_counts` query.[S13] |
| Get Guild Preview | GET | `/guilds/{guild.id}/preview` | |
| Modify Guild | PATCH | `/guilds/{guild.id}` | |
| Get Guild Channels | GET | `/guilds/{guild.id}/channels` | |
| Create Guild Channel | POST | `/guilds/{guild.id}/channels` | |
| Modify Guild Channel Positions | PATCH | `/guilds/{guild.id}/channels` | |
| List Active Guild Threads | GET | `/guilds/{guild.id}/threads/active` | |
| Get Guild Member | GET | `/guilds/{guild.id}/members/{user.id}` | |
| List Guild Members | GET | `/guilds/{guild.id}/members` | Privileged **GUILD_MEMBERS** HTTP restriction.[S2] |
| Search Guild Members | GET | `/guilds/{guild.id}/members/search` | |
| Add Guild Member | PUT | `/guilds/{guild.id}/members/{user.id}` | Needs OAuth2 `guilds.join` access token in body — **bot-core optional / later**; not a user-token selfbot path.[S13] |
| Modify Guild Member | PATCH | `/guilds/{guild.id}/members/{user.id}` | |
| Modify Current Member | PATCH | `/guilds/{guild.id}/members/@me` | |
| Modify Current User Nick | PATCH | `/guilds/{guild.id}/members/@me/nick` | Documented; typically deprecated in favor of Modify Current Member — still listed.[S13] |
| Add Guild Member Role | PUT | `/guilds/{guild.id}/members/{user.id}/roles/{role.id}` | |
| Remove Guild Member Role | DELETE | `/guilds/{guild.id}/members/{user.id}/roles/{role.id}` | |
| Remove Guild Member | DELETE | `/guilds/{guild.id}/members/{user.id}` | |
| Get Guild Bans | GET | `/guilds/{guild.id}/bans` | |
| Get Guild Ban | GET | `/guilds/{guild.id}/bans/{user.id}` | |
| Create Guild Ban | PUT | `/guilds/{guild.id}/bans/{user.id}` | |
| Remove Guild Ban | DELETE | `/guilds/{guild.id}/bans/{user.id}` | |
| Bulk Guild Ban | POST | `/guilds/{guild.id}/bulk-ban` | |
| Get Guild Roles | GET | `/guilds/{guild.id}/roles` | |
| Get Guild Role | GET | `/guilds/{guild.id}/roles/{role.id}` | |
| Get Guild Role Member Counts | GET | `/guilds/{guild.id}/roles/member-counts` | |
| Create Guild Role | POST | `/guilds/{guild.id}/roles` | |
| Modify Guild Role Positions | PATCH | `/guilds/{guild.id}/roles` | |
| Modify Guild Role | PATCH | `/guilds/{guild.id}/roles/{role.id}` | |
| Delete Guild Role | DELETE | `/guilds/{guild.id}/roles/{role.id}` | |
| Get Guild Prune Count | GET | `/guilds/{guild.id}/prune` | |
| Begin Guild Prune | POST | `/guilds/{guild.id}/prune` | |
| Get Guild Voice Regions | GET | `/guilds/{guild.id}/regions` | |
| Get Guild Invites | GET | `/guilds/{guild.id}/invites` | |
| Get Guild Integrations | GET | `/guilds/{guild.id}/integrations` | |
| Delete Guild Integration | DELETE | `/guilds/{guild.id}/integrations/{integration.id}` | |
| Get Guild Widget Settings | GET | `/guilds/{guild.id}/widget` | |
| Modify Guild Widget | PATCH | `/guilds/{guild.id}/widget` | |
| Get Guild Widget | GET | `/guilds/{guild.id}/widget.json` | |
| Get Guild Vanity URL | GET | `/guilds/{guild.id}/vanity-url` | |
| Get Guild Widget Image | GET | `/guilds/{guild.id}/widget.png` | |
| Get Guild Welcome Screen | GET | `/guilds/{guild.id}/welcome-screen` | |
| Modify Guild Welcome Screen | PATCH | `/guilds/{guild.id}/welcome-screen` | |
| Get Guild Onboarding | GET | `/guilds/{guild.id}/onboarding` | |
| Modify Guild Onboarding | PUT | `/guilds/{guild.id}/onboarding` | Verb **SOURCE-CONVENTION** |
| Modify Guild Incident Actions | PUT | `/guilds/{guild.id}/incident-actions` | Verb **SOURCE-CONVENTION** |

### 1.18 Guild scheduled events

| Operation | Method | Path |
| --- | --- | --- |
| List Scheduled Events for Guild | GET | `/guilds/{guild.id}/scheduled-events` |
| Create Guild Scheduled Event | POST | `/guilds/{guild.id}/scheduled-events` |
| Get Guild Scheduled Event | GET | `/guilds/{guild.id}/scheduled-events/{guild_scheduled_event.id}` |
| Modify Guild Scheduled Event | PATCH | `/guilds/{guild.id}/scheduled-events/{guild_scheduled_event.id}` |
| Delete Guild Scheduled Event | DELETE | `/guilds/{guild.id}/scheduled-events/{guild_scheduled_event.id}` |
| Get Guild Scheduled Event Users | GET | `/guilds/{guild.id}/scheduled-events/{guild_scheduled_event.id}/users` |

Max 100 events with status SCHEDULED or ACTIVE.[S30]

### 1.19 Guild templates

| Operation | Method | Path |
| --- | --- | --- |
| Get Guild Template | GET | `/guilds/templates/{template.code}` |
| Get Guild Templates | GET | `/guilds/{guild.id}/templates` |
| Create Guild Template | POST | `/guilds/{guild.id}/templates` |
| Sync Guild Template | PUT | `/guilds/{guild.id}/templates/{template.code}` |
| Modify Guild Template | PATCH | `/guilds/{guild.id}/templates/{template.code}` |
| Delete Guild Template | DELETE | `/guilds/{guild.id}/templates/{template.code}` |

Sync verb **SOURCE-CONVENTION**. Create-guild-from-template **not listed** on this page.[S29]

### 1.20 Invite

| Operation | Method | Path | Notes |
| --- | --- | --- | --- |
| Get Invite | GET | `/invites/{invite.code}` | Query `with_counts`, `guild_scheduled_event_id`.[S31] |
| Delete Invite | DELETE | `/invites/{invite.code}` | |
| Get Target Users | GET | `/invites/{invite.code}/target-users` | CSV response.[S31] |
| Update Target Users | PUT | `/invites/{invite.code}/target-users` | `target_users_file` form upload.[S31] |
| Get Target Users Job Status | GET | `/invites/{invite.code}/target-users/job-status` | |

### 1.21 Stage instance

| Operation | Method | Path |
| --- | --- | --- |
| Create Stage Instance | POST | `/stage-instances` |
| Get Stage Instance | GET | `/stage-instances/{channel.id}` |
| Modify Stage Instance | PATCH | `/stage-instances/{channel.id}` |
| Delete Stage Instance | DELETE | `/stage-instances/{channel.id}` |

[S32]

### 1.22 Soundboard

| Operation | Method | Path | Notes |
| --- | --- | --- | --- |
| Send Soundboard Sound | POST | `/channels/{channel.id}/send-soundboard-sound` | Requires being connected to the voice channel (Voice **protocol** still out of 1.0; this REST may be unused until Voice exists).[S33] |
| List Default Soundboard Sounds | GET | `/soundboard-default-sounds` | |
| List Guild Soundboard Sounds | GET | `/guilds/{guild.id}/soundboard-sounds` | |
| Get Guild Soundboard Sound | GET | `/guilds/{guild.id}/soundboard-sounds/{sound.id}` | |
| Create Guild Soundboard Sound | POST | `/guilds/{guild.id}/soundboard-sounds` | Data URI sound; 512kb / 5.2s.[S33] |
| Modify Guild Soundboard Sound | PATCH | `/guilds/{guild.id}/soundboard-sounds/{sound.id}` | |
| Delete Guild Soundboard Sound | DELETE | `/guilds/{guild.id}/soundboard-sounds/{sound.id}` | |

### 1.23 Voice **resource** (REST, not Voice protocol)

| Operation | Method | Path | Notes |
| --- | --- | --- | --- |
| List Voice Regions | GET | `/voice/regions` | For `rtc_region` on channels.[S34] |
| Get Current User Voice State | GET | `/guilds/{guild.id}/voice-states/@me` | |
| Get User Voice State | GET | `/guilds/{guild.id}/voice-states/{user.id}` | |
| Modify Current User Voice State | PATCH | `/guilds/{guild.id}/voice-states/@me` | Stage-channel caveats.[S34] |
| Modify User Voice State | PATCH | `/guilds/{guild.id}/voice-states/{user.id}` | Stage suppress.[S34] |

### 1.24 User (bot-applicable)

| Operation | Method | Path | 1.0? |
| --- | --- | --- | --- |
| Get Current User | GET | `/users/@me` | Yes — bot user.[S18] |
| Get User | GET | `/users/{user.id}` | Yes.[S18] |
| Modify Current User | PATCH | `/users/@me` | Yes — bot username/avatar/banner.[S18] |
| Get Current User Guilds | GET | `/users/@me/guilds` | Yes — bot’s guilds; paginate (`before`/`after`/`limit` 1–200).[S18] |
| Leave Guild | DELETE | `/users/@me/guilds/{guild.id}` | Yes.[S18] |
| Create DM | POST | `/users/@me/channels` | Yes; do not mass-DM.[S18] |
| Get Current User Guild Member | GET | `/users/@me/guilds/{guild.id}/member` | No — `guilds.members.read` OAuth2.[S18] |
| Create Group DM | POST | `/users/@me/channels` | No — GameBridge / `gdm.join` tokens; bots cannot join Group DMs.[S18][S10] |
| Get Current User Connections | GET | `/users/@me/connections` | No — `connections` scope.[S18] |
| Get/Update/Delete Current User Application Role Connection | GET/PUT/DELETE | `/users/@me/applications/{application.id}/role-connection` | No — `role_connections.write`.[S18] |

### 1.25 Webhook (incoming)

Tokenless execute routes do not require Bot auth; Bot-authenticated management routes do.

| Operation | Method | Path |
| --- | --- | --- |
| Create Webhook | POST | `/channels/{channel.id}/webhooks` |
| Get Channel Webhooks | GET | `/channels/{channel.id}/webhooks` |
| Get Guild Webhooks | GET | `/guilds/{guild.id}/webhooks` |
| Get Webhook | GET | `/webhooks/{webhook.id}` |
| Get Webhook with Token | GET | `/webhooks/{webhook.id}/{webhook.token}` |
| Modify Webhook | PATCH | `/webhooks/{webhook.id}` |
| Modify Webhook with Token | PATCH | `/webhooks/{webhook.id}/{webhook.token}` |
| Delete Webhook | DELETE | `/webhooks/{webhook.id}` |
| Delete Webhook with Token | DELETE | `/webhooks/{webhook.id}/{webhook.token}` |
| Execute Webhook | POST | `/webhooks/{webhook.id}/{webhook.token}` |
| Execute Slack-Compatible Webhook | POST | `/webhooks/{webhook.id}/{webhook.token}/slack` |
| Execute GitHub-Compatible Webhook | POST | `/webhooks/{webhook.id}/{webhook.token}/github` |
| Get Webhook Message | GET | `/webhooks/{webhook.id}/{webhook.token}/messages/{message.id}` |
| Edit Webhook Message | PATCH | `/webhooks/{webhook.id}/{webhook.token}/messages/{message.id}` |
| Delete Webhook Message | DELETE | `/webhooks/{webhook.id}/{webhook.token}/messages/{message.id}` |

[S15]

### 1.26 Explicitly not 1.0 bot-core REST (still official)

- **Lobby** (`/lobbies…`): Social SDK matchmaking; mix of Bot and Bearer `sdk.social_layer`. Not guild bot-core.[S35]
- **Application Identity Profile / Game Stats Widgets** (`/applications/{id}/users/{user}/identities/…`): requires user OAuth2 `application_identities.write`.[S36]
- **Voice connections** (UDP + voice Gateway): separate protocol page.[S37]
- **RPC**, Certified Devices, Embedded App SDK.

---

## 2. Gateway lifecycle

Encoding pin for moon-discord 1.0: `?v=10&encoding=json`. Optional `compress=zlib-stream` or `zstd-stream` is official; payload `compress: true` on Identify is JSON-only per-packet zlib **without** shared context. ETF encoding is official but not required for a JSON-first library.[S2]

### 2.1 High-level cycle

1. Fetch and cache WSS `url` via Get Gateway or Get Gateway Bot.
2. Connect; Discord sends **Hello (op 10)** with `heartbeat_interval` (ms).
3. Heartbeat: first wait `heartbeat_interval * jitter` with jitter in **0..1**, then Heartbeat (op 1) every interval; `d` = last `s` or `null`. Discord ACKs with op **11**. Discord may send op 1; reply immediately with Heartbeat.
4. Identify (op **2**). Success → Dispatch **Ready**.
5. Cache Ready `resume_gateway_url` and `session_id`.
6. Disconnect: use close code to resume vs new Identify.
7. Resume: new socket to **`resume_gateway_url`** (same `v` and `encoding`), send Resume (op **6**). Do not Identify. Missed events then **Resumed**. If too late → Invalid Session (op 9); if `d` is false, new connection on **cached Get Gateway URL** + Identify.[S2]

### 2.2 Heartbeat / zombie

If no Heartbeat ACK between send attempts: **zombied** connection. Terminate with any close code **except 1000 or 1001**, reconnect, attempt Resume.[S2]

Initiating disconnect with **1000 or 1001 invalidates the session** (bot appears offline). Other close / TCP drop: session may remain active and time out — useful for resume.[S2]

### 2.3 Identify limits

- **`max_concurrency`**: Identify requests allowed **per 5 seconds** (session start limit object). Exceed → Invalid Session (op 9).[S2]
- **1000 IDENTIFY calls / 24 hours**, global across shards, **excluding RESUME**. Hitting it: all sessions terminated, **bot token reset**, owner emailed.[S2]
- Large bots (>150k guilds): session start limit increased to `max(2000, (guild_count / 1000) * 5)` per day; increased `max_concurrency`.[S2]

Get Gateway Bot `session_start_limit`: `total`, `remaining`, `reset_after` (ms), `max_concurrency`.[S2]

### 2.4 Gateway send rate limit

**120 Gateway events per connection per 60 seconds** (~2/s). Exceed → immediate disconnect. Repeat offenders: API access revoked.[S2]

Outbound payload **must not exceed 4096 bytes** → close **4002**.[S2]

### 2.5 Invalid Session / Reconnect

- **Reconnect (op 7):** reconnect and Resume immediately; connection may close a few seconds later. Can arrive **before Hello**.[S5]
- **Invalid Session (op 9):** `d` boolean resumable. `true` → Resume (rare); `false` → disconnect, Identify on cached URL.[S2][S5]

Resume when: op 7; disconnect with reconnectable close code; disconnect **with no close code**; op 9 with `d: true`.[S2]

### 2.6 Identify payload fields (v10)

`token`, `properties` (`os`, `browser`, `device` — `$` prefix deprecated), `intents` (required v8+), optional `compress`, `large_threshold` (50–250, default 50), `shard` `[id, num_shards]`, `presence`, `capabilities` (e.g. `CHANNEL_OBFUSCATION` `1 << 15`, testing-only / unstable).[S5]

### 2.7 Guild availability

On bot connect, guilds start **unavailable**; Discord reconnects them; **Guild Create** as they become available.[S2]

### 2.8 Opcode list (Gateway, not Voice)

| op | Name | Direction |
| --- | --- | --- |
| 0 | Dispatch | Receive |
| 1 | Heartbeat | Send/Receive |
| 2 | Identify | Send |
| 3 | Presence Update | Send |
| 4 | Voice State Update | Send (guild Gateway; **in 1.0 as send event**; does not imply Voice protocol) |
| 6 | Resume | Send |
| 7 | Reconnect | Receive |
| 8 | Request Guild Members | Send |
| 9 | Invalid Session | Receive |
| 10 | Hello | Receive |
| 11 | Heartbeat ACK | Receive |
| 31 | Request Soundboard Sounds | Send |
| 43 | Request Channel Info | Send |

Opcode **5 is absent** from the official Gateway opcode table (no documented client action). Voice opcodes (0–31 on the **voice** socket) are **out of 1.0**.[S4]

Request Guild Members limits: 1 `guild_id` per request; `GUILD_MEMBERS` for full list; `GUILD_PRESENCES` for `presences: true`; prefix query max 100; `user_ids` max 100; nonce max 32 bytes; chunks up to 1000 members. Opcode 8 can emit Dispatch **RATE_LIMITED**.[S5]

---

## 3. Dispatch events

Event names are `UPPER_SNAKE_CASE` (`t` on op 0). Title Case in docs maps by replacing spaces with `_` and uppercasing.[S5]

Non-dispatch receive opcodes (Hello, Reconnect, Invalid Session, Heartbeat, Heartbeat ACK) are **not** `t` names.

### 3.1 Receive events (official list) with intents

Events **not** in the intent table are sent **without** an intent (always, if the bot is otherwise eligible).[S2]

| `t` | Intent(s) | Notes |
| --- | --- | --- |
| `READY` | none | Handshake complete; `v`, `user`, unavailable `guilds`, `session_id`, `resume_gateway_url`, optional `shard`, partial `application`.[S5] |
| `RESUMED` | none | Replay finished.[S5] |
| `RATE_LIMITED` | none | Gateway opcode rate limit (e.g. Request Guild Members). Fields: `opcode`, `retry_after`, `meta`.[S5] |
| `APPLICATION_COMMAND_PERMISSIONS_UPDATE` | none | |
| `AUTO_MODERATION_RULE_CREATE` | `AUTO_MODERATION_CONFIGURATION` | Also requires `MANAGE_GUILD` for auto-mod events.[S5] |
| `AUTO_MODERATION_RULE_UPDATE` | `AUTO_MODERATION_CONFIGURATION` | |
| `AUTO_MODERATION_RULE_DELETE` | `AUTO_MODERATION_CONFIGURATION` | |
| `AUTO_MODERATION_ACTION_EXECUTION` | `AUTO_MODERATION_EXECUTION` | |
| `CHANNEL_CREATE` | `GUILDS` | |
| `CHANNEL_UPDATE` | `GUILDS` | |
| `CHANNEL_DELETE` | `GUILDS` | |
| `CHANNEL_INFO` | none (response to op 43) | |
| `CHANNEL_PINS_UPDATE` | `GUILDS` **or** `DIRECT_MESSAGES` | |
| `VOICE_CHANNEL_STATUS_UPDATE` | `GUILDS` | Guild Gateway; not Voice protocol. |
| `VOICE_CHANNEL_START_TIME_UPDATE` | `GUILDS` | |
| `THREAD_CREATE` | `GUILDS` | |
| `THREAD_UPDATE` | `GUILDS` | |
| `THREAD_DELETE` | `GUILDS` | |
| `THREAD_LIST_SYNC` | `GUILDS` | |
| `THREAD_MEMBER_UPDATE` | `GUILDS` | |
| `THREAD_MEMBERS_UPDATE` | `GUILDS` and/or `GUILD_MEMBERS` | Default: only current user add/remove; other users need `GUILD_MEMBERS`.[S2] |
| `ENTITLEMENT_CREATE` | none | |
| `ENTITLEMENT_UPDATE` | none | |
| `ENTITLEMENT_DELETE` | none | |
| `GUILD_CREATE` | `GUILDS` | Also lazy-load / join; uniquely affected by intents.[S2] |
| `GUILD_UPDATE` | `GUILDS` | |
| `GUILD_DELETE` | `GUILDS` | Unavailable or left. |
| `GUILD_AUDIT_LOG_ENTRY_CREATE` | `GUILD_MODERATION` | |
| `GUILD_BAN_ADD` | `GUILD_MODERATION` | |
| `GUILD_BAN_REMOVE` | `GUILD_MODERATION` | |
| `GUILD_EMOJIS_UPDATE` | `GUILD_EXPRESSIONS` | |
| `GUILD_STICKERS_UPDATE` | `GUILD_EXPRESSIONS` | |
| `GUILD_INTEGRATIONS_UPDATE` | `GUILD_INTEGRATIONS` | |
| `GUILD_MEMBER_ADD` | `GUILD_MEMBERS` **privileged** | |
| `GUILD_MEMBER_REMOVE` | `GUILD_MEMBERS` **privileged** | |
| `GUILD_MEMBER_UPDATE` | `GUILD_MEMBERS` **privileged** | **Caveat:** current-user updates sent **even without** the intent.[S2] |
| `GUILD_MEMBERS_CHUNK` | none (response to op 8) | |
| `GUILD_ROLE_CREATE` | `GUILDS` | |
| `GUILD_ROLE_UPDATE` | `GUILDS` | |
| `GUILD_ROLE_DELETE` | `GUILDS` | |
| `GUILD_SCHEDULED_EVENT_CREATE` | `GUILD_SCHEDULED_EVENTS` | |
| `GUILD_SCHEDULED_EVENT_UPDATE` | `GUILD_SCHEDULED_EVENTS` | |
| `GUILD_SCHEDULED_EVENT_DELETE` | `GUILD_SCHEDULED_EVENTS` | |
| `GUILD_SCHEDULED_EVENT_USER_ADD` | `GUILD_SCHEDULED_EVENTS` | |
| `GUILD_SCHEDULED_EVENT_USER_REMOVE` | `GUILD_SCHEDULED_EVENTS` | |
| `GUILD_SOUNDBOARD_SOUND_CREATE` | `GUILD_EXPRESSIONS` | |
| `GUILD_SOUNDBOARD_SOUND_UPDATE` | `GUILD_EXPRESSIONS` | |
| `GUILD_SOUNDBOARD_SOUND_DELETE` | `GUILD_EXPRESSIONS` | |
| `GUILD_SOUNDBOARD_SOUNDS_UPDATE` | `GUILD_EXPRESSIONS` | |
| `SOUNDBOARD_SOUNDS` | none (response to op 31) | |
| `INTEGRATION_CREATE` | `GUILD_INTEGRATIONS` | |
| `INTEGRATION_UPDATE` | `GUILD_INTEGRATIONS` | |
| `INTEGRATION_DELETE` | `GUILD_INTEGRATIONS` | |
| `INTERACTION_CREATE` | none | |
| `INVITE_CREATE` | `GUILD_INVITES` | |
| `INVITE_DELETE` | `GUILD_INVITES` | |
| `MESSAGE_CREATE` | `GUILD_MESSAGES` and/or `DIRECT_MESSAGES` | Content fields gated by `MESSAGE_CONTENT`.[S2] |
| `MESSAGE_UPDATE` | same | |
| `MESSAGE_DELETE` | same | |
| `MESSAGE_DELETE_BULK` | `GUILD_MESSAGES` | |
| `MESSAGE_REACTION_ADD` | `GUILD_MESSAGE_REACTIONS` and/or `DIRECT_MESSAGE_REACTIONS` | |
| `MESSAGE_REACTION_REMOVE` | same | |
| `MESSAGE_REACTION_REMOVE_ALL` | same | |
| `MESSAGE_REACTION_REMOVE_EMOJI` | same | |
| `PRESENCE_UPDATE` | `GUILD_PRESENCES` **privileged** | |
| `STAGE_INSTANCE_CREATE` | `GUILDS` | |
| `STAGE_INSTANCE_UPDATE` | `GUILDS` | |
| `STAGE_INSTANCE_DELETE` | `GUILDS` | |
| `SUBSCRIPTION_CREATE` | none | Premium app; events without `guild_id` go to shard 0.[S2] |
| `SUBSCRIPTION_UPDATE` | none | |
| `SUBSCRIPTION_DELETE` | none | |
| `TYPING_START` | `GUILD_MESSAGE_TYPING` and/or `DIRECT_MESSAGE_TYPING` | |
| `USER_UPDATE` | none | |
| `VOICE_CHANNEL_EFFECT_SEND` | `GUILD_VOICE_STATES` | Guild Gateway. |
| `VOICE_STATE_UPDATE` | `GUILD_VOICE_STATES` | Guild Gateway; **in 1.0**. |
| `VOICE_SERVER_UPDATE` | none | Guild Gateway payload for Voice **protocol** handshake; **receive/dispatch in 1.0**; implementing the Voice server is **out of 1.0**. |
| `WEBHOOKS_UPDATE` | `GUILD_WEBHOOKS` | |
| `MESSAGE_POLL_VOTE_ADD` | `GUILD_MESSAGE_POLLS` and/or `DIRECT_MESSAGE_POLLS` | |
| `MESSAGE_POLL_VOTE_REMOVE` | same | |

`MESSAGE_CONTENT` does **not** gate event delivery; it empties content-bearing fields except: messages the app sent; DMs with the app; mentions of the app; message context-menu target message. Affected fields include `content`, `embeds`, `attachments`, `components`, `poll` on message objects.[S2]

Undocumented Gateway fields: Discord says assume **unsupported** and unstable.[S5]

---

## 4. Interaction transports

Two **mutually exclusive** receive modes: Gateway `INTERACTION_CREATE` **or** HTTP Interactions Endpoint URL. Default is Gateway. Configuring an Interactions Endpoint URL opts into HTTP.[S6][S7]

### 4.1 Types

`PING` 1, `APPLICATION_COMMAND` 2, `MESSAGE_COMPONENT` 3, `APPLICATION_COMMAND_AUTOCOMPLETE` 4, `MODAL_SUBMIT` 5.[S6]

Contexts: `GUILD` 0, `BOT_DM` 1, `PRIVATE_CHANNEL` 2.[S6]

### 4.2 HTTP Interactions Endpoint URL

Must: ACK `PING` with HTTP 200 + body `{ "type": 1 }` (`PONG`); validate **Ed25519**: message = `X-Signature-Timestamp` + **raw body string**, signature header `X-Signature-Ed25519` hex, public key from Developer Portal. Fail → **401**. Discord sends automated invalid signatures; failure **removes the URL**.[S7]

If receiving over HTTP and also calling the callback route, respond to the original POST with **202 and no body**.[S6] Inline response: HTTP **200** + Interaction Response object.[S6]

### 4.3 3-second callback and tokens

`POST /interactions/{interaction.id}/{interaction.token}/callback`  
Tokens valid **15 minutes** for followups; **initial response within 3 seconds** or the token is invalidated.[S6]

Gateway clients **must** HTTP-callback; responses are not Gateway commands.[S6]

Create Interaction Response: **204**, or **200** if `with_response=true`. Supports multipart files. Query `with_response`.[S6]

Callback types: PONG 1; CHANNEL_MESSAGE_WITH_SOURCE 4; DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE 5; DEFERRED_UPDATE_MESSAGE 6 (components); UPDATE_MESSAGE 7 (components); APPLICATION_COMMAND_AUTOCOMPLETE_RESULT 8; MODAL 9 (not for MODAL_SUBMIT/PING); PREMIUM_REQUIRED 10 **deprecated**; LAUNCH_ACTIVITY 12 (Activities).[S6]

### 4.4 Followups (same whether Gateway or HTTP receive)

Not bound to the **application Global Rate Limit**. “Interactions webhooks share the same rate limit properties as normal webhooks.”[S6]

| Operation | Method | Path |
| --- | --- | --- |
| Get Original Interaction Response | GET | `/webhooks/{application.id}/{interaction.token}/messages/@original` |
| Edit Original Interaction Response | PATCH | `/webhooks/{application.id}/{interaction.token}/messages/@original` |
| Delete Original Interaction Response | DELETE | `/webhooks/{application.id}/{interaction.token}/messages/@original` |
| Create Followup Message | POST | `/webhooks/{application.id}/{interaction.token}` |
| Get Followup Message | GET | `/webhooks/{application.id}/{interaction.token}/messages/{message.id}` |
| Edit Followup Message | PATCH | `/webhooks/{application.id}/{interaction.token}/messages/{message.id}` |
| Delete Followup Message | DELETE | `/webhooks/{application.id}/{interaction.token}/messages/{message.id}` |

User-installed-only (`authorizing_integration_owners` only `USER_INSTALL`): **max 5 followup messages** per interaction.[S6]

Using Create Followup immediately after `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` currently edits `@original` (deprecated behavior); docs say use Edit Original instead.[S6]

### 4.5 Rate-limit exceptions

**Interaction endpoints are not bound to the bot’s Global Rate Limit** (50 rps). The receiving-and-responding page repeats that Create Interaction Response and the followup list “are not bound to the application’s Global Rate Limit.”[S3][S6]

---

## 5. Rate limits

Do **not** hard-code bucket sizes. Parse headers and 429 bodies.[S3]

### 5.1 Per-route

May include HTTP method. Shared across similar routes via `X-RateLimit-Bucket`. Major parameters (top-level resources): **`channel_id`**, **`guild_id`**, **`webhook_id` or `webhook_id + webhook_token`**. Different IDs → independent buckets.[S3]

Emoji routes: per-guild; quotas may be wrong; 429s still happen.[S3]

### 5.2 Headers

| Header | Meaning |
| --- | --- |
| `X-RateLimit-Limit` | Max requests |
| `X-RateLimit-Remaining` | Remaining |
| `X-RateLimit-Reset` | Epoch seconds when reset |
| `X-RateLimit-Reset-After` | Seconds until reset (may be fractional) |
| `X-RateLimit-Bucket` | Bucket id (excluding major params) |
| `X-RateLimit-Global` | Only on 429 if global |
| `X-RateLimit-Scope` | On 429: `user` \| `global` \| `shared` |

[S3]

### 5.3 429 body

`message`, `retry_after` (float seconds), `global` (boolean), optional `code`. Also `Retry-After` header. Use header or `retry_after` to wait.[S3]

### 5.4 Global 50 rps

All bots: **50 requests per second** to the API, independent of per-route. Unauthenticated: per IP. Large bots may need Discord support for a raise (`https://dis.gd/rate-limit`).[S3]

**Interaction endpoints are not bound to this global limit.**[S3]

### 5.5 Invalid request tracking / Cloudflare

**10,000 invalid HTTP requests per 10 minutes per IP** → temporary Discord API restriction. Invalid = **401, 403, or 429**. **`X-RateLimit-Scope: shared` 429s are not counted.** Stop on invalid token (401); inspect permissions (403); honor buckets (429); do not retry dead webhooks (404).[S3]

### 5.6 Gateway (separate)

120 events / 60s / connection; Identify concurrency; opcode-specific RATE_LIMITED dispatch (Request Guild Members).[S2][S5]

Lobby “development rate limits” apply only to lobby routes — **not 1.0 bot-core**.[S35]

---

## 6. Intents (v10)

Intents required as of **v8**. Invalid intents → close **4013**. Privileged intent not enabled/approved → **4014**.[S2]

Privileged (exact names): **`GUILD_PRESENCES`**, **`GUILD_MEMBERS`**, **`MESSAGE_CONTENT`**. Toggle in Developer Portal; verified / large-user apps need review. HTTP restrictions (e.g. List Guild Members) are **independent** of which intents were passed at Identify.[S2]

`GUILD_PRESENCES` and `GUILD_MEMBERS` events are **off by default** even if authorized, unless the intent is specified (v8+).[S2]

Apps &lt; 10,000 unique users: enable in portal. Above that: Privileged Intent Review.[S2]

| Intent | Bit | Privileged | Events (from official list) |
| --- | --- | --- | --- |
| `GUILDS` | `1 << 0` | no | GUILD_CREATE/UPDATE/DELETE, GUILD_ROLE_*, CHANNEL_*, CHANNEL_PINS_UPDATE, THREAD_*, STAGE_INSTANCE_*, VOICE_CHANNEL_STATUS_UPDATE, VOICE_CHANNEL_START_TIME_UPDATE |
| `GUILD_MEMBERS` | `1 << 1` | **yes** | GUILD_MEMBER_ADD/UPDATE/REMOVE, THREAD_MEMBERS_UPDATE (other users) |
| `GUILD_MODERATION` | `1 << 2` | no | GUILD_AUDIT_LOG_ENTRY_CREATE, GUILD_BAN_ADD/REMOVE |
| `GUILD_EXPRESSIONS` | `1 << 3` | no | GUILD_EMOJIS_UPDATE, GUILD_STICKERS_UPDATE, GUILD_SOUNDBOARD_SOUND_*, GUILD_SOUNDBOARD_SOUNDS_UPDATE |
| `GUILD_INTEGRATIONS` | `1 << 4` | no | GUILD_INTEGRATIONS_UPDATE, INTEGRATION_* |
| `GUILD_WEBHOOKS` | `1 << 5` | no | WEBHOOKS_UPDATE |
| `GUILD_INVITES` | `1 << 6` | no | INVITE_CREATE/DELETE |
| `GUILD_VOICE_STATES` | `1 << 7` | no | VOICE_CHANNEL_EFFECT_SEND, VOICE_STATE_UPDATE |
| `GUILD_PRESENCES` | `1 << 8` | **yes** | PRESENCE_UPDATE |
| `GUILD_MESSAGES` | `1 << 9` | no | MESSAGE_CREATE/UPDATE/DELETE/DELETE_BULK (guild) |
| `GUILD_MESSAGE_REACTIONS` | `1 << 10` | no | MESSAGE_REACTION_* (guild) |
| `GUILD_MESSAGE_TYPING` | `1 << 11` | no | TYPING_START (guild) |
| `DIRECT_MESSAGES` | `1 << 12` | no | MESSAGE_CREATE/UPDATE/DELETE, CHANNEL_PINS_UPDATE (DM) |
| `DIRECT_MESSAGE_REACTIONS` | `1 << 13` | no | MESSAGE_REACTION_* (DM) |
| `DIRECT_MESSAGE_TYPING` | `1 << 14` | no | TYPING_START (DM) |
| `MESSAGE_CONTENT` | `1 << 15` | **yes** | *(no events; content fields)* |
| `GUILD_SCHEDULED_EVENTS` | `1 << 16` | no | GUILD_SCHEDULED_EVENT_* |
| `AUTO_MODERATION_CONFIGURATION` | `1 << 20` | no | AUTO_MODERATION_RULE_* |
| `AUTO_MODERATION_EXECUTION` | `1 << 21` | no | AUTO_MODERATION_ACTION_EXECUTION |
| `GUILD_MESSAGE_POLLS` | `1 << 24` | no | MESSAGE_POLL_VOTE_* (guild) |
| `DIRECT_MESSAGE_POLLS` | `1 << 25` | no | MESSAGE_POLL_VOTE_* (DM) |

Bits 17–19, 22–23, and ≥26 are **not listed** in the official intent table as of this fetch. Do not invent names for them.[S2]

---

## 7. Sharding

- Max **2500 guilds per shard**. **2500+ guilds → sharding required** (else close **4011**).[S2]
- Identify `shard`: `[shard_id, num_shards]` zero-based id.[S2]
- Recommended count: Get Gateway Bot field **`shards`**.[S2]
- Membership formula: `shard_id = (guild_id >> 22) % num_shards`.[S2]
- Events **without `guild_id`** (DMs, subscription, entitlement) go to **shard 0** only.[S2]
- `num_shards` is routing only; sessions need not be evenly identified; same `[shard_id, num_shards]` may be duplicated for handoff.[S2]
- **max_concurrency buckets:** `rate_limit_key = shard_id % max_concurrency`. Start buckets **in order** (shard 0..max_concurrency-1, then next wave).[S2]
- **Large bots (>150,000 guilds):** Discord assigns a shard multiple; `num_shards` must be a **multiple** of that number or close **4010** Invalid Shard. Get Gateway Bot still returns the correct count.[S2]
- **4010** also: invalid shard in Identify (reconnect = false).[S4]

---

## 8. Protocol / client limits (honor in the library)

Focus: limits that break the client protocol or Identify, not every moderation cap.

| Limit | Value | Source |
| --- | --- | --- |
| Gateway outbound payload | **4096 bytes** else 4002 | [S2] |
| Gateway send | **120 / 60s / connection** | [S2] |
| Identify / 24h | **1000** (large bots: formula in §2.3) | [S2] |
| Identify concurrency | `max_concurrency` per **5 seconds** | [S2] |
| REST global | **50 rps** (interactions exempt) | [S3] |
| Invalid HTTP | **10,000 / 10 minutes** (401/403/429 except shared) | [S3] |
| Snowflake JSON | string in HTTP; Gateway JSON same unless you send non-bigint ids | [S1] |
| TLS | 1.2 | [S1] |
| User-Agent | `DiscordBot (url, version)` | [S1] |
| File upload default | **20 MiB** per file | [S1] |
| `large_threshold` | 50–250 | [S5] |
| Request Guild Members | 1 guild/request; query prefix ≤100; user_ids ≤100; nonce ≤32 bytes; chunk ≤1000 | [S5] |
| Interaction initial ACK | **3 seconds** | [S6] |
| Interaction token | **15 minutes** | [S6] |
| User-install followups | **5** | [S6] |
| Autocomplete choices | **25** | [S6] |
| Modal `custom_id` | 1–100; title max 45; 1–5 components | [S6] |
| Message `content` (webhook/create) | **2000** characters (documented on webhook execute) | [S15] |
| Embeds | up to **10** | [S6][S15] |
| Attachments per message | **10** (JSON 30015) | [S4] |
| Application command body size | error example **8000** (`APPLICATION_COMMAND_TOO_LARGE`) | [S1] |
| Daily application command creates | **200** (JSON 30034) | [S4] |
| Guilds per shard | **2500** | [S2] |
| Bot guild cap | verified bots: no max; (unverified max **UNVERIFIED** on fetched pages — OAuth2 says verified have no maximum) | [S10] |
| Username (bot Modify Current User) | **2–32** characters | [S18] |
| Webhook name | 1–80; not `clyde`/`discord` | [S15] |
| `X-Audit-Log-Reason` | 1–512 URL-encoded UTF-8 | [S11] |
| Poll answers | **10**; question text 300; answer 55; duration hours up to 32 days default 24 | [S27] |
| ETF | not used if JSON-only; atom keys → 4002 | [S2] |

JSON error table contains many **resource** caps (roles 250, channels 500, pins 250, etc.). Libraries should surface those codes; they are not all “protocol” limits. Full table: §9.[S4]

---

## 9. Errors / opcodes / close codes

### 9.1 JSON error shape

Typical: `{ "message": string, "code": integer }`. Form errors (v8+): nested `errors` with `_errors: [{ code, message }]`.[S1][S4]

HTTP statuses the client must handle:[S4]

| Status | Meaning |
| --- | --- |
| 200 | OK |
| 201 | Created |
| 204 | No Content |
| 304 | Not Modified |
| 400 | Bad Request |
| 401 | Unauthorized (missing/invalid Authorization) |
| 403 | Forbidden (token lacks permission) |
| 404 | Not Found |
| 405 | Method Not Allowed |
| 429 | Rate limited |
| 502 | Gateway Unavailable — wait and retry |
| 5xx | Server error (rare) |

JSON `code` catalog is long and Discord says it grows; implement as an extensible integer + message, with known constants from the official table (0, 10001–…, 20001 bots cannot use endpoint, 20002 only bots, 40060 interaction already acknowledged, 40094 max followups, 40333 User-Agent, 50014 invalid token, 50035 invalid form body, 50041 invalid API version, …). Do not treat the table as closed.[S4]

Notable bot-core codes: **20001** Bots cannot use this endpoint; **20002** Only bots can use this endpoint.[S4]

### 9.2 Gateway close codes (application-defined)

Reconnect column is official. **false** → do not reconnect-loop (token/shard/intent/version fatal).[S4]

| Code | Description | Reconnect | Session note |
| --- | --- | --- | --- |
| 4000 | Unknown error | true | |
| 4001 | Unknown opcode | true | |
| 4002 | Decode error | true | Also oversized/invalid payload |
| 4003 | Not authenticated | true | Session invalidated |
| 4004 | Authentication failed | **false** | Bad token |
| 4005 | Already authenticated | true | |
| 4007 | Invalid `seq` | true | **Start a new session** (not Resume with bad seq) |
| 4008 | Rate limited | true | Disconnected for send rate |
| 4009 | Session timed out | true | **Start a new session** |
| 4010 | Invalid shard | **false** | |
| 4011 | Sharding required | **false** | |
| 4012 | Invalid API version | **false** | |
| 4013 | Invalid intent(s) | **false** | |
| 4014 | Disallowed intent(s) | **false** | |

WebSocket **1000/1001** (app-initiated): invalidate session.[S2] Discord’s table does not list 1000/1001 as Gateway application codes.

**Resume vs new Identify:** reconnect `true` is necessary but not sufficient. 4007 and 4009 explicitly require a **new** session. Zombie close must **not** use 1000/1001.[S2][S4]

### 9.3 Voice opcodes / Voice close codes

Documented on the same opcodes page. **Out of 1.0 bot-core** (Voice protocol). Guild Gateway still uses opcode 4 and `VOICE_*` dispatch.[S4][S5]

### 9.4 RPC codes

RPC requires Discord approval. **Out of 1.0**.[S4]

---

## Fog / questions for later tickets

1. **REST 1.0 vs pre-1.0 cut:** Official bot-token REST is large (onboarding, incident actions, target-user CSV invites, monetization, application emojis, search messages). Which resource groups ship in the first public 1.0 vs later minors? Recommend: **core** = Gateway+REST transport, messages/channels/guilds/members/roles/bans, application commands, interactions, webhooks, users/DMs, Get Gateway Bot, rate limits; **1.0-complete** = everything in §1 except Social/Lobby/Identity/Activities/Voice protocol; **deferred** = monetization, identity profile, lobby, Activities instance, Send Soundboard Sound (needs Voice).
2. **HTTP verbs** for Set Voice Channel Status, Modify Onboarding, Incident Actions, Sync Template, Update Target Users: confirm against Discord’s OpenAPI or live examples (markdown headings omitted verbs).
3. **Reaction URL encoding** for Unicode vs custom emoji on v10 (`{emoji.id}` in the path table).
4. **Create Guild / Delete Guild / Create from Template:** absent from current Guild/Template resource pages — confirm removal vs docs gap before exposing methods.
5. **Edit Application Command Permissions** needs Bearer — does 1.0 ship a minimal Bearer helper or omit the method?
6. **HTTP Interactions vs Gateway-only 1.0:** both are official; scriptc static HTTP server vs Gateway-only product cut.
7. **Ed25519:** official HTTP interactions require it; verify on the static tier is an owned TypeScript port ([issue 15](https://github.com/Ermianr/moon-discord/issues/15)), not `node:crypto`.
8. **`capabilities` Identify bitfield** (`CHANNEL_OBFUSCATION`) is explicitly temporary/testing — default 0 for 1.0.
9. **Gateway `RATE_LIMITED` dispatch** vs HTTP 429 — library must not conflate them.
10. **Webhook Events** (`APPLICATION_AUTHORIZED`) are the only documented install signal over HTTP and are **not** Gateway events — if install tracking is in 1.0, that is a separate HTTP product.
11. **Opcode 43 Request Channel Info / CHANNEL_INFO** — new relative to classic bot libraries; include in Gateway send surface.
12. **Privileged intent HTTP list** is not enumerated exhaustively (“for example List Guild Members”). Ticket: inventory every REST route Discord marks as intent-gated.

---

## Sources

- [S1] API Reference — https://docs.discord.com/developers/reference.md
- [S2] Gateway — https://docs.discord.com/developers/events/gateway.md
- [S3] Rate Limits — https://docs.discord.com/developers/topics/rate-limits.md
- [S4] Opcodes and Status Codes — https://docs.discord.com/developers/topics/opcodes-and-status-codes.md
- [S5] Gateway Events — https://docs.discord.com/developers/events/gateway-events.md
- [S6] Receiving and Responding to Interactions — https://docs.discord.com/developers/interactions/receiving-and-responding.md
- [S7] Interactions Overview — https://docs.discord.com/developers/interactions/overview.md
- [S8] Overview of Events — https://docs.discord.com/developers/events/overview.md
- [S9] Webhook Events — https://docs.discord.com/developers/events/webhook-events.md
- [S10] OAuth2 — https://docs.discord.com/developers/topics/oauth2.md
- [S11] Audit Logs Resource — https://docs.discord.com/developers/resources/audit-log.md
- [S12] Application Resource — https://docs.discord.com/developers/resources/application.md
- [S13] Guild Resource — https://docs.discord.com/developers/resources/guild.md
- [S15] Webhook Resource — https://docs.discord.com/developers/resources/webhook.md
- [S16] Message Resource — https://docs.discord.com/developers/resources/message.md
- [S17] Application Commands — https://docs.discord.com/developers/interactions/application-commands.md
- [S18] User Resource — https://docs.discord.com/developers/resources/user.md
- [S19] Application Role Connection Metadata — https://docs.discord.com/developers/resources/application-role-connection-metadata.md
- [S20] Emoji Resource — https://docs.discord.com/developers/resources/emoji.md
- [S21] Entitlement Resource — https://docs.discord.com/developers/resources/entitlement.md
- [S22] SKU Resource — https://docs.discord.com/developers/resources/sku.md
- [S23] Subscription Resource — https://docs.discord.com/developers/resources/subscription.md
- [S24] Auto Moderation — https://docs.discord.com/developers/resources/auto-moderation.md
- [S25] Channels Resource — https://docs.discord.com/developers/resources/channel.md
- [S26] Threads — https://docs.discord.com/developers/topics/threads.md
- [S27] Poll Resource — https://docs.discord.com/developers/resources/poll.md
- [S28] Sticker Resource — https://docs.discord.com/developers/resources/sticker.md
- [S29] Guild Template Resource — https://docs.discord.com/developers/resources/guild-template.md
- [S30] Guild Scheduled Event — https://docs.discord.com/developers/resources/guild-scheduled-event.md
- [S31] Invite Resource — https://docs.discord.com/developers/resources/invite.md
- [S32] Stage Instance Resource — https://docs.discord.com/developers/resources/stage-instance.md
- [S33] Soundboard Resource — https://docs.discord.com/developers/resources/soundboard.md
- [S34] Voice Resource — https://docs.discord.com/developers/resources/voice.md
- [S35] Lobby Resource — https://docs.discord.com/developers/resources/lobby.md
- [S36] Application Identity Profile Resource — https://docs.discord.com/developers/resources/application-identity-profile.md
- [S37] Voice connections (protocol; out of 1.0) — https://docs.discord.com/developers/topics/voice-connections.md
- [S38] Documentation index — https://docs.discord.com/llms.txt

Index used to discover pages: [S38]. HTML equivalents live under the same paths without `.md` on https://docs.discord.com/developers/….
