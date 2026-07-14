# Redis FlowRunner Extension

FlowRunner integration for [Redis](https://redis.io/). Connects directly to a Redis server over TCP using the official [`redis`](https://github.com/redis/node-redis) (node-redis) client and exposes operations for strings, keys, hashes, lists, sets, sorted sets, Pub/Sub publishing, server statistics, and a raw-command escape hatch. It uses a **connect-per-call** model: every operation opens a short-lived client, runs its command, and always closes the connection when the call finishes — no clients or connections are cached between invocations.

## Ideal Use Cases

- Cache computed values, API responses, or session data with automatic expiration (TTL).
- Maintain atomic counters (page views, rate limits, inventory) with Increment/Decrement.
- Use `SET NX` as a lightweight lock or idempotency guard around workflow steps.
- Queue work items with lists (push on one side, pop from the other).
- Track unique members (online users, processed IDs) with sets, and leaderboards with sorted sets.
- Broadcast fire-and-forget notifications to running subscribers via Pub/Sub.
- Monitor server health, memory usage, and database sizes with parsed `INFO` output.

## List of Actions

### Strings

- **Set Value** — `SET` with optional TTL (`EX`) and only-if-not-exists (`NX`); reports whether the value was written.
- **Get Value** — `GET`; returns the value or `null` with an `exists` flag.
- **Increment** — atomic `INCRBY` (or `INCRBYFLOAT` for fractional amounts); returns the new value.
- **Decrement** — atomic `DECRBY` (or negated `INCRBYFLOAT`); returns the new value.

### Keys

- **Delete Keys** — `DEL` one or more keys of any type; returns the deleted count.
- **Key Exists** — `EXISTS` for one or more keys; returns existing/checked counts and an `allExist` flag.
- **Set Expiration** — `EXPIRE` with a positive TTL in seconds.
- **Remove Expiration** — `PERSIST`; makes a key non-expiring again.
- **Get TTL** — `TTL` with raw Redis semantics (`-1` no expiry, `-2` missing) plus convenience flags.
- **Find Keys** — glob-pattern key search using incremental `SCAN` iteration (never the blocking `KEYS` command, so it is safe on production databases); results capped at a configurable limit (default 100).

### Hashes

- **Set Hash Fields** — `HSET` from a JSON object of field/value pairs.
- **Get Hash Field** — `HGET` a single field.
- **Get Hash** — `HGETALL` as a JSON object.
- **Delete Hash Fields** — `HDEL` one or more fields.

### Lists

- **Push To List** — `LPUSH`/`RPUSH` one or more values (side selectable).
- **Pop From List** — `LPOP`/`RPOP` with optional count; always returns a `values` array.
- **Get List Range** — `LRANGE` by index (defaults 0 to -1 return the whole list).
- **List Length** — `LLEN`.

### Sets

- **Add To Set** — `SADD`; returns how many members were newly added.
- **Get Set Members** — `SMEMBERS` (order not guaranteed).
- **Remove From Set** — `SREM`; returns the removed count.

### Sorted Sets

- **Add To Sorted Set** — `ZADD` with `[{score, value}]` members; existing members get their score updated.
- **Get Sorted Range** — `ZRANGE` by rank with optional scores and reverse (descending) order (reverse requires Redis 6.2+).

### Pub/Sub

- **Publish Message** — `PUBLISH` to a channel; returns the subscriber receiver count. Publishing only — subscribing requires a long-lived connection and is not supported.

### Server

- **Get Server Info** — `INFO` parsed into sections (server, clients, memory, persistence, stats, replication, cpu, keyspace, ...); keyspace entries are parsed into `{keys, expires, avgTtl}` per database.

### Advanced

- **Execute Command** — raw escape hatch: run any Redis command by name with string arguments (`sendCommand`), including module commands like `JSON.GET`. Blocking/subscribing commands (`BLPOP`, `SUBSCRIBE`, `MONITOR`) must not be used.

## List of Triggers

This service does not define any triggers.

## Connection Model

Every operation opens a short-lived node-redis client, runs its command, and always closes the connection when the call finishes (success or failure — a graceful `QUIT` with a forced disconnect fallback). No clients or connections are cached between invocations. This keeps each workflow step isolated and avoids stale or leaked connections, at the cost of a small connection-setup overhead per call.

- Connection establishment is bounded by the configurable **Connection Timeout** (default 10 seconds).
- Automatic reconnection is disabled — a dropped socket fails the call immediately instead of retrying.
- For latency-sensitive, high-frequency use, batch related work into fewer calls where possible (e.g. multi-key **Delete Keys**/**Key Exists**, multi-value **Push To List**/**Add To Set**, or a single **Execute Command** covering what would otherwise be several round trips).

## Configuration

Connect with either a single connection string (the copy-paste URI Upstash, Redis Cloud, DigitalOcean, Heroku etc. provide) or individual fields. When Connection String is set it takes precedence and the individual fields are ignored.

| Setting | Required | Description |
| --- | --- | --- |
| Connection String | No | Full Redis URI, e.g. `redis://default:password@redis.example.com:6379` (use `rediss://` for TLS). A database number may be appended as a path (`.../2`). Takes precedence over the fields below. Special characters in the password must be URL-encoded. |
| Host | No* | Hostname or IP address of the Redis server. Must be reachable from FlowRunner. |
| Port | No | TCP port (default `6379`). |
| Username | No | ACL username. Leave empty for the implicit `default` user (typical password-only setups). |
| Password | No | Password (`AUTH`) for the server or ACL user. Leave empty for unauthenticated servers. |
| Database | No | Logical database number to `SELECT` (0-15 on a default server; default `0`). With a connection string, append the number to the URI path instead. |
| Use TLS | No | Enable TLS-encrypted connections (`rediss://`). Required by most managed providers (Upstash, Redis Cloud, DigitalOcean, ElastiCache with in-transit encryption). Certificate verification is relaxed to support managed providers' certificates. With a connection string, enabling this adds TLS on top of the URI; when off, the URI's own scheme stays in charge. |
| Connection Timeout (seconds) | No | How long to wait when establishing a connection (default `10`). |

\* Required when no Connection String is provided.

> **Managed Redis:** Upstash, DigitalOcean, Redis Cloud, and ElastiCache with in-transit encryption almost always require TLS — use a `rediss://` connection string or enable **Use TLS**. A connection that resets immediately (`ECONNRESET` / "Socket closed unexpectedly") is the classic symptom of talking plaintext to a TLS-only endpoint. If the host resolves to an IPv6-only address (`ENETUNREACH`), use an IPv4-compatible endpoint instead.

## Safety Notes

- **Find Keys** uses incremental `SCAN` iteration, never the blocking `KEYS` command, so it is safe to run against production databases; results are capped at the configured limit.
- Redis stores strings: object and array inputs are automatically stored as JSON strings; parse them back in your workflow when reading.
- Redis Pub/Sub is fire-and-forget — a receiver count of 0 from **Publish Message** means no subscriber was listening and the message is gone.
- **Execute Command** sends arguments verbatim as strings (like `redis-cli`); avoid blocking or subscribing commands, which would hold the short-lived connection open.

## Agent Ideas

- Cache an expensive API lookup with Redis "Set Value" (with a TTL) and check "Get Value" first on subsequent runs to skip redundant calls.
- Use "Set Value" with **Only If Not Exists** as an idempotency lock so a webhook-triggered flow processes each event exactly once, and "Increment" to rate-limit outbound requests.
- Push incoming work items onto a list with "Push To List" from one flow, and have another flow "Pop From List" to process them, using **Slack** "Send Message To Channel" to report failures.
- Track leaderboard scores with "Add To Sorted Set" and post the weekly top 10 from "Get Sorted Range" to **Google Sheets** or **Slack**.
- Run "Get Server Info" on a schedule and alert via **Gmail** when `used_memory` or connection counts cross a threshold.
