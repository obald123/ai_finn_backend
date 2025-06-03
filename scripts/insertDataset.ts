const fs = require('fs');
const path = require('path');
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const dataPath = path.join(__dirname, 'dataset/transactions.json');
    const fileContent = fs.readFileSync(dataPath, 'utf-8');
    const transactions = JSON.parse(fileContent);

    for (const t of transactions) {
      const existing = await prisma.transaction.findUnique({
        where: { id: t.id },
      });
      if (!existing) {
        await prisma.transaction.create({
          data: {
            id: t.id,
            date: new Date(t.date),
            amount: t.amount,
            type: t.type,
            category: t.category,
            description: t.description || '',
          },
        });
        console.log(`Inserted transaction id: ${t.id}`);
      } else {
        console.log(`Transaction id: ${t.id} already exists, skipping.`);
      }
    }

    console.log('Dataset insertion completed.');
  } catch (error) {
    console.error('Error inserting dataset:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();

//npx ts-node backend/scripts/insertDataset.ts
