import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "./db.js";
import { signAccessToken } from "./security.js";
import { loginSchema } from "./validators.js";
import { requireAuth } from "./middleware/auth.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid login input" }); return; }
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  const matches = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : false;
  if (!user || !matches) { res.status(401).json({ error: "Invalid email or password" }); return; }
  const token = signAccessToken({ sub: user.id, role: user.role });
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json({ user: req.authUser });
});
