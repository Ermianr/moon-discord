# Discord REST

Source of truth: [API reference](https://docs.discord.com/developers/reference), [rate limits](https://docs.discord.com/developers/topics/rate-limits), and the resource page for the route.

## Shape

```
https://discord.com/api/v10/<route>
Authorization: Bot <token>
User-Agent: DiscordBot ($url, $versionNumber)
Content-Type: application/json
```

Multipart is required when uploading files; follow the resource page, not JSON-only habits.

Get Gateway Bot (`GET /gateway/bot`) before opening a bot Gateway session. Cache the `url`. Use `session_start_limit` (`max_concurrency`, `remaining`, `reset_after`) so Identify does not stampede.

## Auth and errors

| Code | Meaning for a library |
| --- | --- |
| 401 | Token rejected — fail loud; do not spin reconnect |
| 403 | Missing permission — typed error to the caller |
| 404 | Unknown resource |
| 429 | Rate limited — wait `retry_after` (body) / `Retry-After`; inspect `X-RateLimit-Scope` (`user` / `global` / `shared`) |
| 5xx | Retry with backoff; Gateway may still be healthy |

JSON error bodies include `code` (Discord JSON error code) and `message`. Surface both.

## Buckets

Per-route limits share a bucket id in `X-RateLimit-Bucket`. Group by that header, not by URL string alone (major parameters like `channel_id` still distinguish buckets — Discord documents this on the rate-limits page).

Headers to store per bucket: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Reset-After`.

Global: **50 requests/second** per bot. Implement a process-wide limiter in Rest, not in each route helper.

Invalid-request tracking: too many 401/403/429 can get the app temporarily blocked. Treat 401 storms as a hard stop.

## Interactions HTTP

If the bot uses the interactions incoming-webhook model: verify the **Interaction signature** (owned TypeScript Ed25519 in the Rest graph; not `node:crypto` on 0.0.36), respond within **3 seconds**. That path can ship without Gateway. See `docs/research/http-interaction-signature-verify.md`.

## DX for routes

One function per documented operation, named after the docs heading (`createMessage`, `getGatewayBot`). Path params are snowflake **strings**. Query and body types are owned structs built by the caller, then serialized — extra fields are a caller bug, not Discord JSON.

Do not generate a kitchen-sink `rest.request(method, url, body: any)`. If a generic escape hatch exists, its body type is `unknown` and it is not the happy path.
