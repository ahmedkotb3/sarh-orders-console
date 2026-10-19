import "express-async-errors";
import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { env } from "./env.js";
import { authRouter } from "./auth.js";
import { ordersRouter } from "./orders.js";

export const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: env.CLIENT_ORIGIN, methods: ["GET", "POST", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"] }));
app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/orders", ordersRouter);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));
const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  // Do not expose database or stack details to clients; log full detail on the server.
  console.error("Unhandled API error:", error);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
};
app.use(errors);
