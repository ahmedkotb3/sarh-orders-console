CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Order_customerName_trgm_idx"
  ON "Order" USING GIN ("customerName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Order_customerEmail_trgm_idx"
  ON "Order" USING GIN ("customerEmail" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Order_status_amount_id_idx"
  ON "Order" ("status", "amount", "id");
