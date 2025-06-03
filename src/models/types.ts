import { Decimal } from "@prisma/client/runtime/library";

export interface FinancialTransaction {
  id: string;
  date: Date;
  amount: Decimal;
  type: "income" | "expense";
  category: string;
  description: string;
}

export interface PayrollEntry {
  id: string;
  employeeId: string;
  salary: Decimal;
  deductions: Decimal;
  netPay: Decimal;
  paymentDate: Date;
  status: string;
}

export interface CategoryAnalysis {
  category: string;
  totalAmount: Decimal;
  transactionCount: number;
  averageAmount: Decimal;
  trend: "increasing" | "decreasing" | "stable";
}

export interface TransactionTrend {
  date: Date;
  income: Decimal;
  expenses: Decimal;
  netBalance: Decimal;
}

export interface FinancialMetrics {
  currentBalance: Decimal;
  monthlyRevenue: Decimal;
  monthlyExpenses: Decimal;
  profitMargin: Decimal;
  cashFlow: Decimal;
}

export interface PredictionModel {
  id: string;
  name: string;
  type: string;
  parameters: any;
  accuracy: number;
  lastUpdated: Date;
}

export interface FinancialReport {
  startDate: Date;
  endDate: Date;
  totalIncome: Decimal;
  totalExpenses: Decimal;
  netProfit: Decimal;
  transactions: FinancialTransaction[];
}

export interface User {
  id: string;
  email: string;
  username?: string;
  notificationsEnabled?: boolean;
  theme?: string;
  role: { name: string };
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  address?: string;
  idNumber?: string;
  profilePicture?: string;
}
