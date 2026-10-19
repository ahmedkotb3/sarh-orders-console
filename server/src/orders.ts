import { createHash } from "node:crypto";
import { Prisma, OrderStatus } from "@prisma/client";
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "./db.js";
import { requireAuth, requireRole } from "./middleware/auth.js";
import { createOrderSchema } from "./validators.js";

const listSchema = z.object({
  q: z.string().trim().max(120).optional().default(""),
  status: z.preprocess(value => value === "" ? undefined : value, z.nativeEnum(OrderStatus).optional()),
  sortBy: z.enum(["createdAt", "amount"]).optional().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  page: z.coerce.number().int().min(1).max(1000000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25)
});

function canonicalPayload(value: z.infer<typeof createOrderSchema>) {
  return JSON.stringify({
    customerName: value.customerName.trim(),
    customerEmail: value.customerEmail.trim().toLowerCase(),
    items: value.items.map(i => ({ name: i.name.trim(), quantity: i.quantity, unitPrice: Number(i.unitPrice.toFixed(2)) })),
    amount: Number(value.amount.toFixed(2))
  });
}
function hashPayload(value: z.infer<typeof createOrderSchema>) {
  return createHash("sha256").update(canonicalPayload(value)).digest("hex");
}
function toOrder(order: { id: string; customerName: string; customerEmail: string; status: OrderStatus; amount: Prisma.Decimal; createdAt: Date; items: { id: string; name: string; quantity: number; unitPrice: Prisma.Decimal }[] }) {
  return {
    ...order, amount: Number(order.amount), items: order.items.map(item => ({ ...item, unitPrice: Number(item.unitPrice) }))
  };
}
const includeItems = { items: { orderBy: { id: "asc" as const } } };

export const ordersRouter = Router();
ordersRouter.use(requireAuth);

ordersRouter.get("/", async (req: Request, res: Response) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Invalid query parameters", details: parsed.error.flatten() }); return; }
  const { q, status, sortBy, sortOrder, page, pageSize } = parsed.data;
  const where: Prisma.OrderWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [
      { customerName: { contains: q, mode: "insensitive" } },
      { customerEmail: { contains: q, mode: "insensitive" } }
    ] } : {})
  };
  const [total, orders] = await prisma.$transaction([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where, skip: (page - 1) * pageSize, take: pageSize,
      orderBy: [{ [sortBy]: sortOrder }, { id: sortOrder }],
      include: includeItems
    })
  ]);
  res.json({ data: orders.map(o => toOrder(o)), page, pageSize, total, totalPages: Math.ceil(total / pageSize) });
});

ordersRouter.post("/", async (req: Request, res: Response) => {
  const key = req.header("Idempotency-Key");
  if (!key || key.length > 200 || !/^[\x21-\x7E]+$/.test(key)) {
    res.status(400).json({ error: "A valid Idempotency-Key header is required" }); return;
  }
  const parsed = createOrderSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid order", details: parsed.error.flatten() }); return; }
  const payloadHash = hashPayload(parsed.data);
  try {
    const order = await prisma.$transaction(async tx => {
      const created = await tx.order.create({
        data: {
          idempotencyKey: key, payloadHash,
          customerName: parsed.data.customerName.trim(),
          customerEmail: parsed.data.customerEmail.trim().toLowerCase(),
          amount: new Prisma.Decimal(parsed.data.amount.toFixed(2)),
          items: { create: parsed.data.items.map(item => ({
            name: item.name.trim(), quantity: item.quantity,
            unitPrice: new Prisma.Decimal(item.unitPrice.toFixed(2))
          })) }
        },
        include: includeItems
      });
      await tx.orderIdempotency.create({ data: { key, payloadHash, orderId: created.id } });
      return created;
    });
    res.status(201).json(toOrder(order));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const record = await prisma.orderIdempotency.findUnique({ where: { key } });
      const existing = record
        ? await prisma.order.findUnique({ where: { id: record.orderId }, include: includeItems })
        : await prisma.order.findUnique({ where: { idempotencyKey: key }, include: includeItems });
      const existingHash = record?.payloadHash ?? existing?.payloadHash;
      if (existingHash && existingHash !== payloadHash) {
        res.status(409).json({ error: "Idempotency key was already used for a different payload" }); return;
      }
      if (record && !existing) {
        res.status(410).json({ error: "This idempotent order was deleted and cannot be recreated" }); return;
      }
      if (!existing) { res.status(503).json({ error: "Conflicting request; retry with the same key" }); return; }
      res.status(200).json(toOrder(existing));
      return;
    }
    throw error;
  }
});

// Destructive route exists to demonstrate the backend authorization boundary.
ordersRouter.delete("/:id", requireRole("admin"), async (req: Request, res: Response) => {
  const id = z.string().min(1).max(64).safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "Invalid order id" }); return; }
  try {
    await prisma.order.delete({ where: { id: id.data } });
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      res.status(404).json({ error: "Order not found" }); return;
    }
    throw error;
  }
});
