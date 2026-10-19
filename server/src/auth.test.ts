import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { app } from "./app.js";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { verifyAccessToken } from "./security.js";

describe("authentication and authorization", () => {
  let agentToken = "";
  let agentId = "";
  beforeAll(async () => {
    const email = `agent-test-${randomUUID()}@sarh.local`;
    const user = await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash("AgentPass123!", 4), role: "agent" } });
    agentId = user.id;
    const login = await request(app).post("/api/auth/login").send({ email, password: "AgentPass123!" });
    agentToken = login.body.token as string;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: agentId } });
  });

  it("rejects missing and forged tokens", async () => {
    expect((await request(app).get("/api/orders")).status).toBe(401);
    const forged = jwt.sign({ sub: agentId, role: "admin" }, "wrong-secret");
    expect((await request(app).get("/api/orders").set("Authorization", "Bearer " + forged)).status).toBe(401);
  });

  it("enforces admin role on delete at the server", async () => {
    const response = await request(app).delete("/api/orders/nonexistent-id")
      .set("Authorization", "Bearer " + agentToken);
    expect(response.status).toBe(403);
  });

  it("does not accept tokens in query strings", async () => {
    expect((await request(app).get(`/api/orders?token=${encodeURIComponent(agentToken)}`)).status).toBe(401);
  });

  it("rejects otherwise valid tokens without an expiration", () => {
    const token = jwt.sign({ role: "agent" }, env.JWT_SECRET, {
      subject: agentId, issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE, algorithm: "HS256"
    });
    expect(() => verifyAccessToken(token)).toThrow();
  });
});
