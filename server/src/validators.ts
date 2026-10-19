import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  password: z.string().min(1).max(128)
}).strict();

export const createOrderSchema = z.object({
  customerName: z.string().trim().min(2).max(120),
  customerEmail: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  items: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    quantity: z.number().int().min(1).max(9999),
    unitPrice: z.number().finite().min(0.01).max(10000000)
  }).strict()).min(1).max(5),
  amount: z.number().finite().min(0.01).max(100000000)
}).strict().superRefine((value, ctx) => {
  const calculated = value.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  if (Math.abs(calculated - value.amount) > 0.011) {
    ctx.addIssue({ code: "custom", path: ["amount"], message: "Amount must equal the sum of line items" });
  }
});
