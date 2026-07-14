# PGVector FlowRunner Extension

FlowRunner integration for [pgvector](https://github.com/pgvector/pgvector) — the open-source vector-similarity extension for [PostgreSQL](https://www.postgresql.org/). It connects directly to a PostgreSQL server over TCP using the official [`pg`](https://node-postgres.com/) driver and exposes everything needed to build a vector store: enabling the extension, creating vector tables and ANN indexes, inserting/upserting embeddings, and running nearest-neighbour similarity searches. It uses a **connect-per-call** model: every operation opens a short-lived `pg.Client`, runs its query, and always closes the connection when the call finishes — no connections or pools are cached between invocations.

## Ideal Use Cases

- Build a semantic-search or Retrieval-Augmented Generation (RAG) backend on top of PostgreSQL.
- Store embeddings produced by an embedding model (OpenAI, Cohere, local models) alongside their source text and metadata.
- Retrieve the most similar documents to a query embedding for grounding an LLM's answer.
- Deduplicate or cluster records by vector similarity.
- Maintain a vector index that stays in sync with your existing relational data.

## List of Actions

### Extension

- **Enable Extension** — `CREATE EXTENSION IF NOT EXISTS vector`. Run once per database before using vector features.

### Tables

- **Create Vector Table** — create a table with a `vector(dimension)` column, a selectable primary key (Serial / Text / UUID), and optional `{name, type}` metadata columns.

### Indexes

- **Create Index** — build an **HNSW** or **IVFFlat** approximate-nearest-neighbour index for a chosen metric (Cosine / L2 / Inner Product), with optional tuning (`lists` for IVFFlat; `m` and `ef_construction` for HNSW). An index dramatically speeds up similarity search on large tables.

### Embeddings

- **Insert Embeddings** — bulk-insert rows whose embedding column is an array of numbers (converted to a vector literal); other keys become regular column values.
- **Upsert Embeddings** — `INSERT ... ON CONFLICT ... DO UPDATE` keyed by a conflict column; ideal for re-embedding in place.
- **Delete Embeddings** — delete by a list of ids or by an equality `Where` object (exactly one, to prevent full-table deletes).

### Search

- **Similarity Search** — return the nearest rows to a query embedding, ordered nearest-first, with a computed `distance` column. Supports column selection, equality `Where` filters, and an advanced raw SQL filter (120s execution limit).

### SQL

- **Execute Query** — run any SQL statement with `$1, $2, ...` placeholders bound via the Parameters array; vector literals are passed as strings like `'[0.1,0.2,0.3]'` (120s execution limit).

### Schema

- **Get Table Schema** — column names, types, nullability, defaults, positions, and an `isVector` flag from `information_schema.columns`.
- **List Tables** — all tables and views in user schemas, each flagged with `hasVectorColumn`.

## List of Triggers

This service does not define any triggers.

## Connection Model

Every operation opens a short-lived `pg.Client`, runs its query, and always closes the connection when the call finishes (success or failure). No connections or pools are cached between invocations. This keeps each workflow step isolated and avoids stale or leaked connections, at the cost of a small connection-setup overhead per call.

- Connection establishment is bounded by the configurable **Connection Timeout** (default 10 seconds).
- Statements are bounded by a 120-second `statement_timeout`.

## Extension Setup

pgvector must be installed and enabled on the target database before vector operations work.

1. Ensure the pgvector extension is **available** on the server. Most managed providers ship it: Supabase, Neon, AWS RDS/Aurora, Google Cloud SQL, and Azure Database all include pgvector. For self-hosted Postgres, install it from [pgvector/pgvector](https://github.com/pgvector/pgvector).
2. Run the **Enable Extension** action once per database (`CREATE EXTENSION IF NOT EXISTS vector`). This requires a role with the privilege to create extensions (typically a superuser or the database owner).
3. Create a table with **Create Vector Table**, add an index with **Create Index**, then start inserting embeddings and searching.

## Distance Operators & Metrics

pgvector adds a `vector` column type and distance operators. This service exposes three metrics; for each, a **smaller distance means more similar**, so results are ordered ascending by distance:

| Metric (label) | Operator | Computes | Index operator class |
| --- | --- | --- | --- |
| Cosine | `<=>` | Cosine distance | `vector_cosine_ops` |
| L2 | `<->` | L2 (Euclidean) distance | `vector_l2_ops` |
| Inner Product | `<#>` | Negative inner product | `vector_ip_ops` |

- Embeddings are represented in SQL as string literals like `'[0.1,0.2,0.3]'`. This service builds that literal for you from an array of numbers and passes it as a bound parameter.
- **Cosine similarity = 1 − cosine distance.** When you need a similarity score in `[0, 1]`, subtract the returned `distance` from 1.
- The metric used in **Similarity Search** must match the operator class of the index for the index to be used.

## Index Types

An index makes similarity search on large tables dramatically faster (without one, searches perform an exact but slower full scan).

- **HNSW** — highest recall and query speed, slower to build, more memory. Tunables: `m` (max connections per layer, default 16) and `ef_construction` (build-time candidate list, default 64).
- **IVFFlat** — faster to build and lighter on memory. Tunable: `lists` (number of inverted lists; a common starting point is rows / 1000 for up to ~1M rows). Best created after the table already holds representative data.

## Similarity Search Flow

1. **Enable Extension** on the database (once).
2. **Create Vector Table** with the correct `dimension` for your embedding model (e.g. 1536 for OpenAI `text-embedding-3-small`).
3. **Insert Embeddings** (or **Upsert Embeddings**) — store each vector alongside its text/metadata.
4. **Create Index** with the metric you intend to query by (e.g. Cosine / HNSW).
5. **Similarity Search** — pass a query embedding and the same metric to retrieve the nearest rows with their `distance`.

## Configuration

Connect with either a single connection string (the copy-paste URI Supabase, Neon, RDS, Heroku etc. provide) or individual fields. When Connection String is set it takes precedence and the individual fields are ignored.

| Setting | Required | Description |
| --- | --- | --- |
| Connection String | No | Full PostgreSQL URI, e.g. `postgresql://user:password@db.example.com:5432/mydb`. Takes precedence over the fields below. Special characters in the password must be URL-encoded. |
| Host | No* | Hostname or IP address of the PostgreSQL server. Must be reachable from FlowRunner. |
| Port | No | TCP port (default `5432`). |
| Database | No* | Database name to connect to. |
| User | No* | Database user (role) name. |
| Password | No* | Password for the database user. |
| Use SSL/TLS | No | Enable TLS-encrypted connections. Required by most managed databases (AWS RDS, Google Cloud SQL, Azure Database, Heroku Postgres). Certificate verification is relaxed to support managed providers' default certificates. With a connection string, enabling this adds TLS on top of the URI; when off, any `sslmode` in the URI still applies. |
| Connection Timeout (seconds) | No | How long to wait when establishing a connection (default `10`). |

\* Required when no Connection String is provided.

> **Supabase:** use the **Session pooler** connection string from the dashboard's Connect dialog (`postgres.<project-ref>@aws-0-<region>.pooler.supabase.com:5432`). The direct `db.<project-ref>.supabase.co` endpoint is IPv6-only and typically unreachable from FlowRunner (`ENETUNREACH`). Enable **Use SSL/TLS**.

## Safety Notes

- All **values** are bound as query parameters (`$1, $2, ...`) — never interpolated into SQL. This includes vector literals, which are built from arrays of numbers and passed as bound parameters.
- **Identifiers** (table and column names) cannot be bound as parameters, so they are escaped with double-quote doubling before being placed in SQL. Metadata column **types** in Create Vector Table are validated against a safe token set before use.
- Table names may be schema-qualified (`analytics.documents`); unqualified names default to the `public` schema.
- In `Where` condition objects: `null` values match `IS NULL`, array values match any element (`= ANY(...)`), all other values use equality; conditions are combined with `AND`.
- **Delete Embeddings** requires exactly one of `IDs` or `Where` to prevent accidental full-table deletion.
- The **Where Clause (raw SQL)** parameter on Similarity Search is NOT parameterized — never place untrusted user input in it. Use the `Where` object for user-supplied values.

## Agent Ideas

- Call **OpenAI** "Create Embeddings" (or **Cohere** "Create Embeddings") to vectorize a user's question, then PGVector **Similarity Search** to fetch the most relevant documents for a Retrieval-Augmented Generation answer.
- After ingesting new content, use **Cohere** "Create Embeddings" to embed each chunk and PGVector **Upsert Embeddings** to keep the vector store in sync, then run **Create Index** once to accelerate future searches.
- Combine PGVector **Similarity Search** with **Slack** "Send Message To Channel" to surface the closest matching knowledge-base articles to a support question.
