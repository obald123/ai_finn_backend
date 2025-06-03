import { prisma } from './src/utils/prisma';
import { PredictionService } from './src/services/predictionService';

async function main() {
  try {
    
    const transactions = await prisma.financialTransaction.findMany();

    if (transactions.length === 0) {
      console.log('No transactions found in the database to train the model.');
      return;
    }

    
    const formattedTransactions = transactions.map(t => ({
      id: t.id,
      date: new Date(t.date),
      amount: Number(t.amount),
      type: t.type as 'income' | 'expense',
      category: t.category,
      description: t.description || '',
    }));

    const predictionService = new PredictionService();

    console.log('Training model with', formattedTransactions.length, 'transactions...');
    await predictionService.trainModel(formattedTransactions);
    console.log('Model training and saving completed successfully.');
  } catch (error) {
    console.error('Error during model training:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
