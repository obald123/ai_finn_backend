import { Router } from "express";
import { TransactionRepository } from "../../repositories/transactionRepository";
import { PredictionService } from "../../services/predictionService";
import { FinancialOperationsService } from "../../services/financialOperationsService";
import { adminAuth } from "../../middleware/adminAuth";
const router = Router();
const transactionRepo = new TransactionRepository();
const predictionService = new PredictionService();
const financialService = new FinancialOperationsService();

router.get("/payroll/current", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const payrollSalary = await financialService.getCurrentPayrollSalary(
      userId
    );
    res.json({ payrollSalary });
  } catch (error: unknown) {
    console.error("Error fetching current payroll salary:", error);
    res.status(500).json({ error: "Failed to fetch current payroll salary" });
  }
});

router.get("/metrics", async (req, res) => {
  try {
    const metrics = await financialService.getFinancialMetrics();
    const cashFlowData = await financialService.getCashFlowData(30);
    res.json({
      ...metrics,
      totalIncome: metrics.monthlyRevenue.toNumber(),
      totalExpenses: metrics.monthlyExpenses.toNumber(),
      netIncome: metrics.monthlyRevenue.sub(metrics.monthlyExpenses).toNumber(),
      cashFlow: cashFlowData,
      categoryBreakdown: [],
    });
  } catch (error: unknown) {
    res.status(500).json({ error: "Failed to fetch financial metrics" });
  }
});

router.post("/reset", adminAuth, async (req, res) => {
  try {
    await financialService.resetAllTransactionsAndMetrics();
    res.json({
      message: "All transactions and financial metrics have been reset.",
    });
  } catch (error: unknown) {
    console.error("Error resetting transactions and metrics:", error);
    res.status(500).json({ error: "Failed to reset transactions and metrics" });
  }
});

router.get("/metrics/changes", async (req, res) => {
  try {
    const period = (req.query.period as "day" | "week" | "month") || "month";
    const changes = await financialService.getMetricsChanges(period);
    res.json(changes);
  } catch (error: unknown) {
    res.status(500).json({ error: "Failed to fetch metrics changes" });
  }
});

router.post("/transactions", async (req, res) => {
  try {
    const transaction = await financialService.processTransaction(req.body);
    res.json(transaction);
  } catch (error: unknown) {
    console.error("Error creating transaction:", error);
    const message = error instanceof Error ? error.message : String(error);
    res
      .status(500)
      .json({ error: "Failed to create transaction", details: message });
  }
});

router.get("/transactions", async (req, res) => {
  try {
    const startDateStr = req.query.startDate as string;
    const endDateStr = req.query.endDate as string;

    if (!startDateStr || !endDateStr) {
      if (req.body && req.body.startDate && req.body.endDate) {
        req.query.startDate = req.body.startDate;
        req.query.endDate = req.body.endDate;
      } else {
        return res
          .status(400)
          .json({ error: "Missing startDate or endDate query parameter" });
      }
    }

    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res
        .status(400)
        .json({ error: "Invalid startDate or endDate query parameter" });
    }

    const transactions = await transactionRepo.findByDateRange(
      startDate,
      endDate
    );
    res.json(transactions);
  } catch (error: unknown) {
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

router.get("/predictions/cashflow", async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);
    const transactions = await transactionRepo.findByDateRange(
      startDate,
      endDate
    );

    const recentTransactions = transactions.map((t) => ({
      id: t.id,
      date: t.date,
      amount: t.amount,
      type: t.type as "income" | "expense",
      category: t.category,
      description: t.description || "",
    }));

    const predictions = await predictionService.predict(
      recentTransactions.map((t) => ({ ...t, amount: t.amount.toNumber() })),
      days
    );
    res.json(predictions);
  } catch (error: unknown) {
    res.status(500).json({ error: "Failed to generate predictions" });
  }
});

router.get("/predictions/models", async (req, res) => {
  try {
    const models = await predictionService.getModels();
    res.json(models);
  } catch (error: unknown) {
    res.status(500).json({ error: "Failed to fetch prediction models" });
  }
});

router.post("/payroll", adminAuth, async (req, res) => {
  try {
    const payrollEntries = await financialService.processPayroll(req.body);
    res.json(payrollEntries);
  } catch (error: unknown) {
    console.error("Error processing payroll:", error);
    res.status(500).json({ error: "Failed to process payroll" });
  }
});

router.post("/payroll/send-email", adminAuth, async (req, res) => {
  try {
    const { to, payrollEntries } = req.body;
    if (!to || !payrollEntries) {
      return res
        .status(400)
        .json({ error: "Missing 'to' or 'payrollEntries' in request body" });
    }
    await financialService.sendPayrollEmail(to, payrollEntries);
    res.json({ message: "Payroll report email sent successfully" });
  } catch (error: unknown) {
    console.error("Error sending payroll email:", error);
    res.status(500).json({ error: "Failed to send payroll email" });
  }
});

router.get("/payroll/status", adminAuth, async (req, res) => {
  try {
    const year = parseInt(req.query.year as string);
    const month = parseInt(req.query.month as string);

    if (isNaN(year) || isNaN(month)) {
      return res.status(400).json({ error: "Invalid year or month parameter" });
    }

    const payrollStatus = await financialService.getPayrollStatusForMonth(
      year,
      month
    );
    res.json(payrollStatus);
  } catch (error: unknown) {
    console.error("Error fetching payroll status:", error);
    res.status(500).json({ error: "Failed to fetch payroll status" });
  }
});

router.get("/analysis/categories", async (req, res) => {
  try {
    const startDate = new Date(req.query.startDate as string);
    const endDate = new Date(req.query.endDate as string);
    const analysis = await financialService.getCategoryAnalysis(
      startDate,
      endDate
    );
    res.json(analysis);
  } catch (error: unknown) {
    res.status(500).json({ error: "Failed to fetch category analysis" });
  }
});

router.get("/analysis/trends", async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const trends = await financialService.getTransactionTrends(days);
    res.json(trends);
  } catch (error: unknown) {
    res.status(500).json({ error: "Failed to fetch transaction trends" });
  }
});

router.get("/reports/ai-generated", async (req, res) => {
  try {
    const report = await financialService.getAIGeneratedReports();
    if (!report) {
      return res
        .status(200)
        .json({ message: "No data available to generate a report" });
    }
    res.json(report);
  } catch (error: unknown) {
    res.status(500).json({ error: "Failed to fetch AI-generated reports" });
  }
});

router.post("/calculate-tax", async (req, res) => {
  try {
    const { income, payrollSalary } = req.body;
    if (typeof income !== "number" || income < 0) {
      return res.status(400).json({ error: "Invalid income provided" });
    }
    if (typeof payrollSalary !== "number" || payrollSalary < 0) {
      return res.status(400).json({ error: "Invalid payrollSalary provided" });
    }
    const taxResult = await financialService.calculateTax(income, payrollSalary);
    res.json(taxResult);
  } catch (error: unknown) {
    console.error("Tax calculation error in backend:", error);
    res.status(500).json({ error: "Failed to calculate tax" });
  }
});

router.post("/tax/send-email", async (req, res) => {
  try {
    const { to, income, payrollSalary } = req.body;
    if (!to || income === undefined || payrollSalary === undefined) {
      return res
        .status(400)
        .json({
          error: "Missing 'to', 'income' or 'payrollSalary' in request body",
        });
    }
    await financialService.sendTaxEmail(to, income, payrollSalary);
    res.json({ message: "Tax payment report email sent successfully" });
  } catch (error: unknown) {
    console.error("Error sending tax payment email:", error);
    res.status(500).json({ error: "Failed to send tax payment email" });
  }
});

export default router;
