import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { app } from "./app.js";
import { prisma } from "./db.js";

describe("order idempotency integration", () => {
  let token = "";
  const key = `parallel-test-${randomUUID()}`;
  const deletedKey = `deleted-test-${randomUUID()}`;
  const payload = {
    customerName: "Parallel Test Customer",
    customerEmail: "parallel-test@example.test",
    items: [{ name: "Test item", quantity: 2, unitPrice: 10.5 }],
    amount: 21
  };

  beforeAll(async () => {
    const email = `test-${randomUUID()}@sarh.local`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash("TestPass123!", 4), role: "admin" }
    });
    const login = await request(app).post("/api/auth/login").send({ email, password: "TestPass123!" });
    expect(login.status).toBe(200);
    token = login.body.token as string;
    // The user is retained until afterAll so the token's subject remains valid.
    void user;
  });

  afterAll(async () => {
    await prisma.orderIdempotency.deleteMany({ where: { key: { in: [key, deletedKey] } } });
    await prisma.order.deleteMany({ where: { idempotencyKey: { in: [key, deletedKey] } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "test-" } } });
    await prisma.$disconnect();
  });

  it("creates exactly one order for two concurrent identical requests", async () => {
    const send = () => request(app).post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(payload);
    const [first, second] = await Promise.all([send(), send()]);
    expect([201, 200]).toContain(first.status);
    expect([201, 200]).toContain(second.status);
    expect(first.body.id).toBe(second.body.id);
    const count = await prisma.order.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);
  });

  it("keeps the idempotency key reserved after an order is deleted", async () => {
    const created = await request(app).post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", deletedKey)
      .send(payload);
    expect(created.status).toBe(201);

    const deleted = await request(app).delete(`/api/orders/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(deleted.status).toBe(200);

    const retry = await request(app).post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", deletedKey)
      .send(payload);
    expect(retry.status).toBe(410);
    expect(await prisma.order.count({ where: { idempotencyKey: deletedKey } })).toBe(0);
  });

  it("rejects reuse of an idempotency key for a different payload", async () => {
    const conflict = await request(app).post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send({ ...payload, customerName: "Different Customer" });
    expect(conflict.status).toBe(409);
  });
});
