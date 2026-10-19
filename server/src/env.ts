import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string()
    .min(32, "JWT_SECRET must contain at least 32 characters")
    .refine(value => value !== "replace-with-at-least-32-random-bytes", "JWT_SECRET must be a generated secret, not the example placeholder"),
  JWT_ISSUER: z.string().default("sarh-orders-console"),
  JWT_AUDIENCE: z.string().default("sarh-orders-client"),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173")
});
export const env = envSchema.parse(process.env);
