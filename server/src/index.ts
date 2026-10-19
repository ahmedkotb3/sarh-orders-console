import { app } from "./app.js";
import { env } from "./env.js";
import { prisma } from "./db.js";

const server = app.listen(env.PORT, () => {
  console.log(`SARH Orders API listening on http://localhost:${env.PORT}`);
});
async function shutdown() {
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
