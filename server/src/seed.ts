import bcrypt from "bcryptjs";
import { Prisma, PrismaClient, OrderStatus, UserRole } from "@prisma/client";

const prisma = new PrismaClient();
const names = ["Amina Hassan", "Omar Farouk", "Layla Nasser", "Youssef Adel", "Mariam Khalil", "Karim Samir", "Nour Ibrahim", "Salma Mostafa", "Adam Tarek", "Farah Emad"];
const products = [
  { name: "Wireless Mouse", price: 18.5 }, { name: "USB-C Hub", price: 34.99 },
  { name: "Laptop Stand", price: 27.25 }, { name: "Mechanical Keyboard", price: 79.0 },
  { name: "Webcam HD", price: 45.75 }, { name: "Desk Lamp", price: 22.4 },
  { name: "Notebook Set", price: 8.99 }, { name: "Headphones", price: 59.95 }
];
const statuses: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.PROCESSING, OrderStatus.COMPLETED, OrderStatus.CANCELLED];

async function main() {
  console.log("Clearing demo records...");
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.user.deleteMany();

  const adminHash = await bcrypt.hash("AdminPass123!", 10);
  const agentHash = await bcrypt.hash("AgentPass123!", 10);
  await prisma.user.createMany({ data: [
    { email: "admin@sarh.local", passwordHash: adminHash, role: UserRole.admin },
    { email: "agent@sarh.local", passwordHash: agentHash, role: UserRole.agent }
  ] });

  const now = Date.now();
  const totalOrders = 50000;
  const batchSize = 250;
  console.log(`Seeding ${totalOrders.toLocaleString()} orders...`);
  for (let start = 0; start < totalOrders; start += batchSize) {
    const data = [];
    const end = Math.min(start + batchSize, totalOrders);
    for (let i = start; i < end; i++) {
      const customer = names[i % names.length]!;
      const itemCount = 1 + (i % 5);
      const items = Array.from({ length: itemCount }, (_, j) => {
        const product = products[(i + j * 3) % products.length]!;
        const quantity = 1 + ((i + j) % 3);
        return { name: product.name, quantity, unitPrice: product.price };
      });
      const amount = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const customerEmail = `${customer.toLowerCase().replace(/[^a-z]+/g, ".")}.${i}@example.test`;
      const createdAt = new Date(now - ((i * 7919) % (365 * 24 * 60 * 60 * 1000)));
      data.push({
        idempotencyKey: `seed-order-${i}`,
        payloadHash: `seed-${i}`,
        customerName: customer,
        customerEmail,
        status: statuses[i % statuses.length]!,
        amount: new Prisma.Decimal(amount.toFixed(2)),
        createdAt,
        items: { create: items.map(item => ({ ...item, unitPrice: new Prisma.Decimal(item.unitPrice.toFixed(2)) })) }
      });
    }
    await prisma.$transaction(data.map(order => prisma.order.create({ data: order })));
    if (end % 5000 === 0) console.log(`  ${end.toLocaleString()} / ${totalOrders.toLocaleString()}`);
  }
  console.log("Seed complete. Admin: admin@sarh.local / AdminPass123! | Agent: agent@sarh.local / AgentPass123!");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
