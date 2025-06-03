import { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "../utils/prisma";
import type { FinancialTransaction } from "../models/types";

export class TransactionRepository {
  async create(
    data: Omit<FinancialTransaction, "id" | "createdAt" | "updatedAt">
  ): Promise<FinancialTransaction> {
    const result = await prisma.transaction.create({
      data: {
        ...data,
        date: data.date,
        type: data.type,
        category: data.category,
        amount: new Decimal(data.amount.toString()),
      },
    });
    return this.mapToFinancialTransaction(result);
  }

  async findAll(): Promise<FinancialTransaction[]> {
    const results = await prisma.transaction.findMany({
      orderBy: {
        date: "desc",
      },
    });
    return results.map(this.mapToFinancialTransaction);
  }

  async findById(id: string): Promise<FinancialTransaction | null> {
    const result = await prisma.transaction.findUnique({
      where: { id },
    });
    return result ? this.mapToFinancialTransaction(result) : null;
  }

  async update(
    id: string,
    data: Partial<Omit<FinancialTransaction, "id" | "createdAt" | "updatedAt">>
  ): Promise<FinancialTransaction> {
    const updateData = { ...data };
    if (data.amount) {
      updateData.amount = new Decimal(data.amount.toString());
    }
    const result = await prisma.transaction.update({
      where: { id },
      data: updateData,
    });
    return this.mapToFinancialTransaction(result);
  }

  async delete(id: string): Promise<FinancialTransaction> {
    const result = await prisma.transaction.delete({
      where: { id },
    });
    return this.mapToFinancialTransaction(result);
  }

  async findByDateRange(
    startDate: Date,
    endDate: Date
  ): Promise<FinancialTransaction[]> {
    const results = await prisma.transaction.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
      orderBy: {
        date: "asc",
      },
    });
    return results.map(this.mapToFinancialTransaction);
  }

  private mapToFinancialTransaction(data: any): FinancialTransaction {
    return {
      ...data,
      type: data.type as "income" | "expense",
    };
  }

  async getMetrics(startDate?: Date, endDate?: Date) {
    const whereClause =
      startDate && endDate
        ? {
            date: {
              gte: startDate,
              lte: endDate,
            },
          }
        : {};

    const transactions = await prisma.transaction.findMany({
      where: whereClause,
    });

    const totalIncome = transactions
      .filter((t) => t.type === "income")
      .reduce((sum, t) => sum.add(t.amount), new Decimal(0));

    const totalExpenses = transactions
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => sum.add(t.amount), new Decimal(0));

    interface CategoryMetric {
      category: string;
      amount: Decimal;
    }

    const categoryBreakdown = transactions.reduce(
      (acc: CategoryMetric[], t): CategoryMetric[] => {
        const existing = acc.find((c) => c.category === t.category);
        if (existing) {
          existing.amount = existing.amount.add(t.amount);
        } else {
          acc.push({ category: t.category, amount: t.amount });
        }
        return acc;
      },
      [] as CategoryMetric[]
    );

    return {
      totalIncome,
      totalExpenses,
      netIncome: totalIncome.sub(totalExpenses),
      categoryBreakdown,
    };
  }

  async getMonthlyMetrics(
    date: Date
  ): Promise<{ income: Decimal; expenses: Decimal }> {
    const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);

    const transactionsByType = await prisma.transaction.groupBy({
      by: ["type"],
      where: {
        date: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      _sum: {
        amount: true,
      },
    });

    const income = new Decimal(
      transactionsByType
        .find((t) => t.type === "income")
        ?._sum.amount?.toString() || "0"
    );
    const expenses = new Decimal(
      transactionsByType
        .find((t) => t.type === "expense")
        ?._sum.amount?.toString() || "0"
    );

    return { income, expenses };
  }

  async deleteAllTransactions() {
    await prisma.transaction.deleteMany({});
  }
}
