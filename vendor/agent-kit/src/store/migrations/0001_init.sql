-- 0001_init — the store schema (ARCHITECTURE §27.1).
-- Baseline uses plain pgvector 0.8 with an HNSW index (always installable). The
-- M0 spike (§23.2) decides whether to swap to pgvectorscale/diskann; that lands
-- as a later migration, not here, so the schema is bootable on a stock image.
-- Every vector column is origin-filterable; every ANN index assumes
-- hnsw.iterative_scan=relaxed_order (set per-recall, §7.4). now() is Postgres's.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- substring fallback for zero-IDF tool search (§10.1)

-- ── memory: episodic/semantic/learnings/inner share one table, partitioned by collection ──
CREATE TABLE IF NOT EXISTS memory (
  id           bigint GENERATED ALWAYS AS IDENTITY,
  collection   text        NOT NULL,       -- episodic|semantic|learnings|inner
  origin       text        NOT NULL,       -- owner|internal|untrusted  (§7.4)
  embed_model  text        NOT NULL,       -- provenance for reindex
  dim          int         NOT NULL,
  embedding    vector(768) NOT NULL,       -- baseline; M0 may switch to halfvec/diskann (§23.2)
  preview      text        NOT NULL,       -- <=200 chars, PII-bounded
  body_ref     text,                       -- pointer, not the raw transcript
  content_hash text        NOT NULL,       -- per-(collection,origin) dedupe surface (§7.4)
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
) PARTITION BY LIST (collection);

CREATE TABLE IF NOT EXISTS memory_episodic  PARTITION OF memory FOR VALUES IN ('episodic');
CREATE TABLE IF NOT EXISTS memory_semantic  PARTITION OF memory FOR VALUES IN ('semantic');
CREATE TABLE IF NOT EXISTS memory_learnings PARTITION OF memory FOR VALUES IN ('learnings');
CREATE TABLE IF NOT EXISTS memory_inner     PARTITION OF memory FOR VALUES IN ('inner');

-- Filtered ANN: partial index over trusted rows keeps write-agent recall correct (§7.4).
CREATE INDEX IF NOT EXISTS memory_embedding_trusted
  ON memory USING hnsw (embedding vector_cosine_ops)
  WHERE origin IN ('owner','internal');
CREATE INDEX IF NOT EXISTS memory_embedding_all
  ON memory USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS memory_collection_origin ON memory (collection, origin);
-- dedupe is per (collection, origin) at write time (§7.4), enforced in code, not a constraint
CREATE INDEX IF NOT EXISTS memory_dedupe ON memory (collection, origin, content_hash);

-- ── durable conversation history (§7.3) ──
CREATE TABLE IF NOT EXISTS history (
  conversation_key text        NOT NULL,   -- channel or channel:thread
  seq              bigint      NOT NULL,
  role             text        NOT NULL,
  content          jsonb       NOT NULL,   -- message blocks incl. tool_use/tool_result
  origin           text        NOT NULL DEFAULT 'internal',
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_key, seq)
);

-- ── job queue (§14) ──
CREATE TABLE IF NOT EXISTS jobs (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind                text        NOT NULL,
  payload             jsonb       NOT NULL,
  priority            int         NOT NULL DEFAULT 100,
  status              text        NOT NULL DEFAULT 'ready',   -- ready|leased|done|dead
  attempts            int         NOT NULL DEFAULT 0,
  lease_expires_at    timestamptz,
  idempotency_key     text UNIQUE,                            -- also the dedupe surface
  origin_conversation text,
  last_error          text,
  run_after           timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_claim ON jobs (priority, run_after)   -- the SKIP LOCKED claim index
  WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS jobs_lease ON jobs (lease_expires_at)
  WHERE status = 'leased';

-- ── durable cron (§15) ──
CREATE TABLE IF NOT EXISTS schedule (
  id          text        PRIMARY KEY,     -- = registrable id
  cron        text        NOT NULL,
  next_fire   timestamptz NOT NULL,
  catchup     text        NOT NULL DEFAULT 'skip',            -- skip|catchup
  last_fired  timestamptz
);
CREATE INDEX IF NOT EXISTS schedule_next_fire ON schedule (next_fire);

-- ── inbound dedupe (§14): Telegram update_id / iMessage GUID ──
CREATE TABLE IF NOT EXISTS processed_inbound (
  channel     text        NOT NULL,
  external_id text        NOT NULL,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, external_id)
);                                          -- TTL-reaped (daily delete < now()-interval)
CREATE INDEX IF NOT EXISTS processed_inbound_seen_at ON processed_inbound (seen_at);

-- ── footprint ledger (§11): time series, partition by day ──
CREATE TABLE IF NOT EXISTS footprint_ledger (
  ts                 timestamptz NOT NULL DEFAULT now(),
  component_id       text        NOT NULL,
  cold_tokens        int,
  calls              int,
  tool_ms_p50        int,
  tool_ms_p95        int,
  in_tokens_est      bigint,
  out_tokens_est     bigint,
  usd_est            numeric,
  cache_read_tokens  bigint,
  cache_write_tokens bigint,
  error_count        int
);
CREATE INDEX IF NOT EXISTS footprint_ledger_ts ON footprint_ledger (component_id, ts);

-- ── generic kv (config snapshots, feature flags, small durable state) ──
CREATE TABLE IF NOT EXISTS kv (
  k          text        PRIMARY KEY,
  v          jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
