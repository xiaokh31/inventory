BEGIN;
CREATE TABLE IF NOT EXISTS warehouse_inventory_meta (
  singleton integer PRIMARY KEY CHECK (singleton = 1),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO warehouse_inventory_meta (singleton, revision) VALUES (1, 0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS warehouse_inventory_records (
  id text PRIMARY KEY,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
