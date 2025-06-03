import { TransactionRepository } from "../repositories/transactionRepository";
import { PredictionService } from "./predictionService";
import {
  FinancialTransaction,
  PayrollEntry,
  CategoryAnalysis,
  TransactionTrend,
} from "../models/types";
import prisma from "../utils/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import { sendEmail } from "../utils/email";

export class FinancialOperationsService {
  private transactionRepo: TransactionRepository;
  private predictionService: PredictionService;

  constructor() {
    this.transactionRepo = new TransactionRepository();
    this.predictionService = new PredictionService();
  }

  async getCashFlowData(days: number = 30): Promise<{ date: string; amount: number }[]> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days + 1);

    const transactions = await this.transactionRepo.findByDateRange(startDate, endDate);

    // Aggregate transactions by date
    const cashFlowMap = new Map<string, number>();

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      cashFlowMap.set(dateStr, 0);
    }

    transactions.forEach((t) => {
      const dateStr = t.date.toISOString().split("T")[0];
      const prevAmount = cashFlowMap.get(dateStr) || 0;
      const amount = t.type === "income" ? t.amount.toNumber() : -t.amount.toNumber();
      cashFlowMap.set(dateStr, prevAmount + amount);
    });

    // Convert map to array sorted by date
    const cashFlowArray = Array.from(cashFlowMap.entries())
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return cashFlowArray;
  }

  async getCurrentPayrollSalary(userId: string): Promise<number> {
    const latestPayroll = await prisma.payroll.findFirst({
      where: { employeeId: userId, status: "processed" },
      orderBy: { paymentDate: "desc" },
      select: { salary: true },
    });
    return latestPayroll?.salary.toNumber() ?? 0;
  }

  async getPayrollStatusForMonth(year: number, month: number) {
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const payrollRecords = await prisma.payroll.findMany({
      where: {
        paymentDate: {
          gte: startDate,
          lte: endDate,
        },
        status: "processed",
      },
      select: {
        employeeId: true,
        paymentDate: true,
      },
    });

    return payrollRecords;
  }

  async resetAllTransactionsAndMetrics() {
    await this.transactionRepo.deleteAllTransactions();

    const currentMetrics = await prisma.financialMetrics.findFirst({
      orderBy: { updatedAt: "desc" },
    });

    if (currentMetrics) {
      await prisma.financialMetrics.update({
        where: { id: currentMetrics.id },
        data: {
          currentBalance: new Decimal(0),
          monthlyRevenue: new Decimal(0),
          monthlyExpenses: new Decimal(0),
          profitMargin: new Decimal(0),
          cashFlow: new Decimal(0),
        },
      });
    } else {
      await prisma.financialMetrics.create({
        data: {
          currentBalance: new Decimal(0),
          monthlyRevenue: new Decimal(0),
          monthlyExpenses: new Decimal(0),
          profitMargin: new Decimal(0),
          cashFlow: new Decimal(0),
        },
      });
    }
  }

  async getFinancialMetrics() {
    const currentMetrics = await prisma.financialMetrics.findFirst({
      orderBy: { updatedAt: "desc" },
    });

    if (!currentMetrics) {
      return this.initializeFinancialMetrics();
    }

    return currentMetrics;
  }

  private async initializeFinancialMetrics() {
    return prisma.financialMetrics.create({
      data: {
        currentBalance: new Decimal(0),
        monthlyRevenue: new Decimal(0),
        monthlyExpenses: new Decimal(0),
        profitMargin: new Decimal(0),
        cashFlow: new Decimal(0),
      },
    });
  }

  async getMetricsChanges(period: "day" | "week" | "month") {
    const endDate = new Date();
    let startDate = new Date();

    switch (period) {
      case "day":
        startDate.setDate(startDate.getDate() - 1);
        break;
      case "week":
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "month":
        startDate.setMonth(startDate.getMonth() - 1);
        break;
    }

    const [currentPeriod, previousPeriod] = await Promise.all([
      this.transactionRepo.getMonthlyMetrics(endDate),
      this.transactionRepo.getMonthlyMetrics(startDate),
    ]);

    return {
      balanceChange: currentPeriod.income
        .sub(currentPeriod.expenses)
        .sub(previousPeriod.income.sub(previousPeriod.expenses)),
      revenueChange: currentPeriod.income.sub(previousPeriod.income),
      expenseChange: currentPeriod.expenses.sub(previousPeriod.expenses),
    };
  }

  async processTransaction(transaction: Omit<FinancialTransaction, "id">) {
    const newTransaction = await this.transactionRepo.create(transaction);
    await this.updateFinancialMetrics(transaction);
    return newTransaction;
  }

  private async updateFinancialMetrics(
    transaction: Omit<FinancialTransaction, "id">
  ) {
    const currentMetrics = await this.getFinancialMetrics();
    const amount = new Decimal(transaction.amount.toString());

    const updates = {
      currentBalance:
        transaction.type === "income"
          ? currentMetrics.currentBalance.add(amount)
          : currentMetrics.currentBalance.sub(amount),
      monthlyRevenue:
        transaction.type === "income"
          ? currentMetrics.monthlyRevenue.add(amount)
          : currentMetrics.monthlyRevenue,
      monthlyExpenses:
        transaction.type === "expense"
          ? currentMetrics.monthlyExpenses.add(amount)
          : currentMetrics.monthlyExpenses,
    };

    const profitMargin = updates.monthlyRevenue.gt(new Decimal(0))
      ? updates.monthlyRevenue
          .sub(updates.monthlyExpenses)
          .div(updates.monthlyRevenue)
          .mul(new Decimal(100))
      : new Decimal(0);

    await prisma.financialMetrics.update({
      where: { id: currentMetrics.id },
      data: {
        ...updates,
        profitMargin,
        cashFlow: updates.monthlyRevenue.sub(updates.monthlyExpenses),
      },
    });
  }

  async processPayroll(entries: PayrollEntry[]) {
    const processedEntries = [];

    for (const entry of entries) {
      if (!entry.employeeId) {
        throw new Error("Missing employeeId in payroll entry");
      }
      if (entry.netPay === undefined || entry.netPay === null) {
        throw new Error("Missing netPay in payroll entry");
      }
      if (!entry.paymentDate) {
        throw new Error("Missing paymentDate in payroll entry");
      }

      // Set defaults for optional fields
      const salary = entry.salary ?? 0;
      const deductions = entry.deductions ?? 0;
      const status = entry.status ?? "processed";

      const processedEntry = await prisma.payroll.create({
        data: {
          employeeId: entry.employeeId,
          salary,
          deductions,
          netPay: entry.netPay,
          paymentDate: new Date(entry.paymentDate),
          status,
        },
      });

      await this.processTransaction({
        date: new Date(entry.paymentDate),
        amount: entry.netPay,
        type: "expense",
        category: "Payroll",
        description: `Payroll payment for employee ${entry.employeeId}`,
      });

      processedEntries.push(processedEntry);
    }

    return processedEntries;
  }

  async sendPayrollEmail(to: string, payrollEntries: PayrollEntry[]) {
    if (!to) {
      throw new Error("Recipient email address is required");
    }
    if (!payrollEntries || payrollEntries.length === 0) {
      throw new Error("No payroll entries to send");
    }

    const htmlRows = payrollEntries
      .map(
        (entry) => `
      <tr>
        <td>${entry.employeeId}</td>
        <td>${entry.salary ?? 0}</td>
        <td>${entry.deductions ?? 0}</td>
        <td>${entry.netPay}</td>
        <td>${new Date(entry.paymentDate).toLocaleDateString()}</td>
        <td>${entry.status ?? "processed"}</td>
      </tr>
    `
      )
      .join("");

    const html = `
      <h2>Payroll Report</h2>
      <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">
        <thead>
          <tr>
            <th>Employee ID</th>
            <th>Salary</th>
            <th>Deductions</th>
            <th>Net Pay</th>
            <th>Payment Date</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${htmlRows}
        </tbody>
      </table>
    `;

    const subject = "Payroll Report";

    return sendEmail(to, subject, html);
  }

  async getCategoryAnalysis(startDate: Date, endDate: Date): Promise<any> {
    const allowedCategories = new Set([
      "Salary",
      "Taxes",
      "Product Sold",
      "Utilities",
      "Other",
    ]);

    const transactions = await this.transactionRepo.findByDateRange(
      startDate,
      endDate
    );
    const categoryMap = new Map<string, any>();

    transactions.forEach((transaction) => {
      if (!allowedCategories.has(transaction.category)) {
        return;
      }
      const existing = categoryMap.get(transaction.category) || {
        category: transaction.category,
        amount: new Decimal(0),
        transactionCount: 0,
        averageAmount: new Decimal(0),
        trend: "stable",
      };

      existing.amount = existing.amount.add(transaction.amount);
      existing.transactionCount += 1;
      existing.averageAmount = existing.amount.div(
        new Decimal(existing.transactionCount)
      );
      categoryMap.set(transaction.category, existing);
    });

    const midPoint = new Date((startDate.getTime() + endDate.getTime()) / 2);
    const firstHalf = transactions.filter((t) => t.date < midPoint);
    const secondHalf = transactions.filter((t) => t.date >= midPoint);

    for (const [category, analysis] of categoryMap.entries()) {
      const firstHalfTotal = firstHalf
        .filter((t) => t.category === category)
        .reduce((sum, t) => sum.add(t.amount), new Decimal(0));

      const secondHalfTotal = secondHalf
        .filter((t) => t.category === category)
        .reduce((sum, t) => sum.add(t.amount), new Decimal(0));

      if (secondHalfTotal.gt(firstHalfTotal.mul(new Decimal("1.1")))) {
        analysis.trend = "increasing";
      } else if (secondHalfTotal.lt(firstHalfTotal.mul(new Decimal("0.9")))) {
        analysis.trend = "decreasing";
      }
    }

    return Array.from(categoryMap.values());
  }

  async getTransactionTrends(days: number): Promise<any> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const transactions = await this.transactionRepo.findByDateRange(
      startDate,
      endDate
    );
    const dates: string[] = [];
    const income: number[] = [];
    const expenses: number[] = [];

    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split("T")[0];
      dates.push(dateStr);

      const dayTransactions = transactions.filter(
        (t) => t.date.toISOString().split("T")[0] === dateStr
      );

      const dayIncome = dayTransactions
        .filter((t) => t.type === "income")
        .reduce((sum, t) => sum.add(t.amount), new Decimal(0))
        .toNumber();

      const dayExpenses = dayTransactions
        .filter((t) => t.type === "expense")
        .reduce((sum, t) => sum.add(t.amount), new Decimal(0))
        .toNumber();

      income.push(dayIncome);
      expenses.push(dayExpenses);

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return {
      dates,
      income,
      expenses,
    };
  }

  async getAIGeneratedReports(): Promise<any> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30); // Last 30 days

    const transactions = await this.transactionRepo.findByDateRange(
      startDate,
      endDate
    );

    if (transactions.length === 0) {
      return null;
    }

    const metrics = await this.getFinancialMetrics();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todaysTransactions = await this.transactionRepo.findByDateRange(
      todayStart,
      todayEnd
    );

    const transactionsForPrediction = transactions.map((t) => ({
      id: t.id,
      date: t.date,
      amount: t.amount.toNumber(),
      type: t.type,
      category: t.category,
      description: t.description,
    }));

    const predictions = await this.predictionService.predict(
      transactionsForPrediction,
      7
    );

    const totalIncome = transactions
      .filter((t) => t.type === "income")
      .reduce((sum, t) => sum.add(t.amount), new Decimal(0))
      .toNumber();
    const totalExpenses = transactions
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => sum.add(t.amount), new Decimal(0))
      .toNumber();

    const todaysTotalIncome = todaysTransactions
      .filter((t) => t.type === "income")
      .reduce((sum, t) => sum.add(t.amount), new Decimal(0))
      .toNumber();
    const todaysTotalExpenses = todaysTransactions
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => sum.add(t.amount), new Decimal(0))
      .toNumber();

    const report = {
      title: "AI-Generated Financial Activity Report",
      date: new Date().toISOString().split("T")[0],
      summary: `This report summarizes financial activities from ${
        startDate.toISOString().split("T")[0]
      } to ${endDate.toISOString().split("T")[0]}.`,
      keyMetrics: {
        currentBalance: metrics.currentBalance.toNumber(),
        monthlyRevenue: metrics.monthlyRevenue.toNumber(),
        monthlyExpenses: metrics.monthlyExpenses.toNumber(),
        profitMargin: metrics.profitMargin.toNumber(),
        cashFlow: metrics.cashFlow.toNumber(),
      },
      recentActivitySummary: {
        totalTransactions: transactions.length,
        totalIncome: totalIncome,
        totalExpenses: totalExpenses,
        netCashFlow: totalIncome - totalExpenses,
      },
      currentDayActivitySummary: {
        totalTransactions: todaysTransactions.length,
        totalIncome: todaysTotalIncome,
        totalExpenses: todaysTotalExpenses,
        netCashFlow: todaysTotalIncome - todaysTotalExpenses,
      },
      predictionSummary: {
        predictedCashFlowNext7Days: predictions.predictedCashFlow.reduce(
          (sum: number, p: { amount: number }) => sum + p.amount,
          0
        ),
        confidence: predictions.confidence,
      },
      recommendations: [
        "Review high-spending categories for potential savings.",
        "Consider increasing investments based on positive cash flow predictions.",
        "Monitor upcoming expenses to maintain healthy cash reserves.",
      ],
    };

    return report;
  }

  async calculateTax(
    income: number,
    payrollSalary: number
  ): Promise<{ tva: number; paye: number; totalTax: number }> {
    const tva = income * 0.18;

    // Calculate total payroll salary of all users with processed payrolls
    const payrolls = await prisma.payroll.findMany({
      where: { status: "processed" },
      select: { salary: true },
    });

    const totalPayrollSalary = payrolls.reduce(
      (sum, payroll) => sum + payroll.salary.toNumber(),
      0
    );

    const paye = totalPayrollSalary * 0.1;

    const totalTax = tva + paye;

    return { tva, paye, totalTax };
  }

  async sendTaxEmail(to: string, income: number, payrollSalary: number) {
    if (!to) {
      throw new Error("Recipient email address is required");
    }
    if (income < 0 || payrollSalary < 0) {
      throw new Error("Income and payroll salary must be non-negative");
    }

    const { tva, paye, totalTax } = await this.calculateTax(income, payrollSalary);

    const safeIncome = typeof income === "number" ? income : 0;
    const safePayrollSalary = typeof payrollSalary === "number" ? payrollSalary : 0;

    const html = `
      <h2>Tax Payment Report</h2>
      <p>Income: ${safeIncome.toFixed(2)}</p>
      <p>Payroll Salary: ${safePayrollSalary.toFixed(2)}</p>
      <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">
        <thead>
          <tr>
            <th>Tax Type</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>TVA (18%)</td><td>${tva.toFixed(2)}</td></tr>
          <tr><td>PAYE (10%)</td><td>${paye.toFixed(2)}</td></tr>
          <tr><td><strong>Total Tax</strong></td><td><strong>${totalTax.toFixed(
            2
          )}</strong></td></tr>
        </tbody>
      </table>
    `;

    const subject = "Tax Payment Report";

    return sendEmail(to, subject, html);
  }
}
