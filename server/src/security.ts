import jwt from "jsonwebtoken";
import { env } from "./env.js";

export type TokenClaims = { sub: string; role: "admin" | "agent" };
export function signAccessToken(user: TokenClaims) {
  return jwt.sign({ role: user.role }, env.JWT_SECRET, {
    subject: user.sub, expiresIn: "15m", issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE, algorithm: "HS256"
  });
}
export function verifyAccessToken(token: string): TokenClaims {
  const decoded = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ["HS256"], issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE
  });
  if (typeof decoded === "string" || !decoded.sub || (decoded.role !== "admin" && decoded.role !== "agent")) {
    throw new Error("Invalid token claims");
  }
  return { sub: decoded.sub, role: decoded.role };
}
