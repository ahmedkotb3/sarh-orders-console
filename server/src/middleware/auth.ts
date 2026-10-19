import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db.js";
import { verifyAccessToken } from "../security.js";

export type AuthUser = { id: string; email: string; role: "admin" | "agent" };
declare global {
  namespace Express { interface Request { authUser?: AuthUser } }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authorization = req.header("authorization");
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
    res.status(401).json({ error: "Authentication required" }); return;
  }
  let claims: ReturnType<typeof verifyAccessToken>;
  try {
    const token = authorization.replace(/^Bearer\s+/i, "");
    claims = verifyAccessToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true, email: true, role: true } });
  if (!user) { res.status(401).json({ error: "Invalid authentication" }); return; }
  req.authUser = { id: user.id, email: user.email, role: user.role };
  next();
}

export function requireRole(role: "admin" | "agent") {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.authUser) { res.status(401).json({ error: "Authentication required" }); return; }
    if (req.authUser.role !== role) { res.status(403).json({ error: "Insufficient permissions" }); return; }
    next();
  };
}
