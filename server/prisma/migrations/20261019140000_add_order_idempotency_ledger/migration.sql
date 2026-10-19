CREATE TABLE "OrderIdempotency" (
  "key" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderIdempotency_pkey" PRIMARY KEY ("key")
);

INSERT INTO "OrderIdempotency" ("key", "payloadHash", "orderId")
SELECT "idempotencyKey", "payloadHash", "id" FROM "Order";
