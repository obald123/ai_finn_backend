import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const adminRole = await prisma.role.upsert({
    where: { name: "admin" },
    update: {},
    create: { name: "admin" },
  });

  const employerRole = await prisma.role.upsert({
    where: { name: "employee" },
    update: {},
    create: { name: "employee" },
  });

  const adminPassword = await bcrypt.hash("adminpassword", 10);
  const employerPassword = await bcrypt.hash("employerpassword", 10);

  await prisma.user.upsert({
    where: { email: "borisiradukunda18@gmail.com" },
    update: {},
    create: {
      email: "borisiradukunda18@gmail.com",
      password: adminPassword,
      roleId: adminRole.id,
    },
  });

  await prisma.user.upsert({
    where: { email: "employer@example.com" },
    update: {},
    create: {
      email: "employer@example.com",
      password: employerPassword,
      roleId: employerRole.id,
    },
  });

  console.log(
    "Admin, employer, and employee roles ensured, users created/updated successfully."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
