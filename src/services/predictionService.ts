import * as tf from "@tensorflow/tfjs";
import { FinancialTransaction, PredictionModel } from "../models/types";
import { prisma } from "../utils/prisma";
import { Decimal } from "@prisma/client/runtime/library";

function isDecimal(value: any): value is Decimal {
  return (
    value && typeof value === "object" && typeof value.toNumber === "function"
  );
}

export class PredictionService {
  private model: tf.Sequential | null = null;

  private async prepareData(
    transactions: FinancialTransaction[],
    sequenceLength: number = 7
  ) {
    const sortedData: number[] = transactions
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((t) => {
        if (t.type === "income") {
          return isDecimal(t.amount) ? t.amount.toNumber() : t.amount;
        } else {
          return -(isDecimal(t.amount) ? t.amount.toNumber() : t.amount);
        }
      });

    const sequences: number[][] = [];
    const targets: number[] = [];

    for (let i = 0; i <= sortedData.length - sequenceLength - 1; i++) {
      sequences.push(sortedData.slice(i, i + sequenceLength));
      targets.push(sortedData[i + sequenceLength]);
    }

    return {
      sequences: tf.tensor3d(
        sequences.map((seq) => [seq]),
        [sequences.length, 1, sequenceLength]
      ),
      targets: tf.tensor2d(
        targets.map((t) => [t]),
        [targets.length, 1]
      ),
    };
  }

  private async createModel(sequenceLength: number): Promise<tf.Sequential> {
    const model = tf.sequential();

    model.add(
      tf.layers.lstm({
        units: 50,
        inputShape: [1, sequenceLength],
        returnSequences: false,
      })
    );

    model.add(
      tf.layers.dense({
        units: 1,
        activation: "linear",
      })
    );

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: "meanSquaredError",
    });

    return model;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private weightDataArrayBufferToBase64Array(
    weightData: ArrayBuffer[]
  ): string[] {
    return weightData.map((buffer) => this.arrayBufferToBase64(buffer));
  }

  private base64ArrayToWeightDataArrayBuffer(
    base64Array: string[]
  ): ArrayBuffer[] {
    return base64Array.map((base64) => this.base64ToArrayBuffer(base64));
  }

  async trainModel(
    transactions: FinancialTransaction[],
    sequenceLength: number = 7,
    epochs: number = 50
  ) {
    const { sequences, targets } = await this.prepareData(
      transactions,
      sequenceLength
    );
    const model = await this.createModel(sequenceLength);

    await model.fit(sequences, targets, {
      epochs,
      batchSize: 16,
      verbose: 1,
    });

    const saveResult = await model.save(
      tf.io.withSaveHandler(async (modelArtifacts) => {
        const weightDataBase64Array = Array.isArray(modelArtifacts.weightData)
          ? this.weightDataArrayBufferToBase64Array(modelArtifacts.weightData)
          : modelArtifacts.weightData
          ? [this.arrayBufferToBase64(modelArtifacts.weightData)]
          : [];

        const serializableArtifacts = {
          ...modelArtifacts,
          weightData: weightDataBase64Array,
        };

        await prisma.predictionModel.create({
          data: {
            name: "Cash Flow Prediction",
            type: "cashflow",
            parameters: serializableArtifacts as any,
            accuracy: 0,
            lastUpdated: new Date(),
          },
        });
        return {
          modelArtifactsInfo: {
            dateSaved: new Date(),
            modelTopologyType: "JSON",
          },
        };
      })
    );

    this.model = model;
    return saveResult;
  }

  async predict(
    recentTransactions: {
      id: string;
      date: Date;
      amount: number | Decimal;
      type: "income" | "expense";
      category: string;
      description: string;
    }[],
    daysToPredict: number = 30
  ) {
    try {
      if (!this.model) {
        const latestModel = await this.loadLatestModel();
        if (!latestModel) {
          throw new Error("No trained model available");
        }
        this.model = latestModel;
      }

      const sequence: number[] = recentTransactions
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .map((t) => {
          if (t.type === "income") {
            return isDecimal(t.amount) ? t.amount.toNumber() : t.amount;
          } else {
            return -(isDecimal(t.amount) ? t.amount.toNumber() : t.amount);
          }
        });

      let predictedCashFlow: { date: string; amount: number }[] = [];
      let lastSequence: tf.Tensor;

      if (sequence.length < 7) {
        const padding = new Array(7 - sequence.length).fill(0);
        const paddedSequence = padding.concat(sequence);
        lastSequence = tf.tensor3d([[paddedSequence]], [1, 1, 7]);
      } else {
        lastSequence = tf.tensor3d([[sequence.slice(-7)]], [1, 1, 7]);
      }

      let confidence = 0;

      for (let i = 0; i < daysToPredict; i++) {
        const prediction = this.model.predict(lastSequence) as tf.Tensor;
        const predictedValue = (await prediction.data())[0];

        const predictionDate = new Date();
        predictionDate.setDate(predictionDate.getDate() + i + 1);

        predictedCashFlow.push({
          date: predictionDate.toISOString().split("T")[0],
          amount: predictedValue,
        });

        const newSequence = lastSequence.slice([0, 0, 1], [1, 1, 6]);
        const updatedSequence = tf.concat(
          [newSequence, tf.tensor3d([[[predictedValue]]])],
          2
        );
        lastSequence.dispose();
        lastSequence = updatedSequence;
      }

      if (predictedCashFlow.length > 0) {
        const recentTransactionsNumberAmount = recentTransactions.map((t) => ({
          ...t,
          amount: isDecimal(t.amount) ? t.amount.toNumber() : t.amount,
        }));
      // Removed saveModelPerformance call to avoid unreliable dynamic accuracy update
      // await this.saveModelPerformance(
      //   predictedCashFlow[0].amount,
      //   recentTransactionsNumberAmount
      // );

      // Fetch the latest model accuracy as confidence directly
      const latestModel = await prisma.predictionModel.findFirst({
        orderBy: { lastUpdated: "desc" },
      });
      if (latestModel && latestModel.accuracy) {
        confidence = latestModel.accuracy.toNumber();
      }
      }

      return { predictedCashFlow, confidence };
    } catch (error) {
      console.error("Prediction error:", error);
      throw error;
    }
  }

  private async loadLatestModel(): Promise<tf.Sequential | null> {
    const latestModel = await prisma.predictionModel.findFirst({
      orderBy: { lastUpdated: "desc" },
    });

    if (!latestModel || !latestModel.parameters) return null;

    try {
      const storedArtifacts = latestModel.parameters as any;
      const weightDataBase64Array = Array.isArray(storedArtifacts.weightData)
        ? storedArtifacts.weightData
        : storedArtifacts.weightData
        ? [storedArtifacts.weightData]
        : [];

      const weightDataArrayBuffer = this.base64ArrayToWeightDataArrayBuffer(
        weightDataBase64Array
      );

      const modelArtifacts: tf.io.ModelArtifacts = {
        ...storedArtifacts,
        weightData: weightDataArrayBuffer,
      } as tf.io.ModelArtifacts;

      const ioHandler: tf.io.IOHandler = {
        load: async () => {
          return modelArtifacts;
        },
      };

      const model = await tf.loadLayersModel(ioHandler);
      return model as tf.Sequential;
    } catch (error) {
      console.error("Error loading model:", error);
      return null;
    }
  }

  private async saveModelPerformance(
    prediction: number,
    recentTransactions: {
      id: string;
      date: Date;
      amount: number;
      type: "income" | "expense";
      category: string;
      description: string;
    }[]
  ) {
    // Calculate actual value for the day after the last transaction date used in prediction
    if (recentTransactions.length === 0) {
      console.log("saveModelPerformance: No recent transactions available");
      return;
    }
    const lastTransactionDate = recentTransactions[recentTransactions.length - 1].date;
    const nextDay = new Date(lastTransactionDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = nextDay.toISOString().split("T")[0];

    const actualValue = recentTransactions
      .filter((t) => t.date.toISOString().split("T")[0] === nextDayStr)
      .reduce(
        (sum, t) =>
          sum + (t.type === "income" ? Number(t.amount) : -Number(t.amount)),
        0
      );

    console.log(`saveModelPerformance: actualValue=${actualValue}, prediction=${prediction}`);

    let accuracy = 0;
    if (actualValue !== 0) {
      accuracy = Math.max(
        0,
        100 - Math.abs(((prediction - actualValue) / actualValue) * 100)
      );
    } else {
      // If no actual value but prediction exists, keep previous accuracy or set to a default
      const latestModel = await prisma.predictionModel.findFirst({
        orderBy: { lastUpdated: "desc" },
      });
      if (latestModel && latestModel.accuracy) {
        accuracy = latestModel.accuracy.toNumber();
      } else {
        accuracy = 50; // default confidence if no previous accuracy
      }
    }

    console.log(`saveModelPerformance: calculated accuracy=${accuracy}`);

    const latestModel = await prisma.predictionModel.findFirst({
      orderBy: { lastUpdated: "desc" },
    });

    if (latestModel) {
      await prisma.predictionModel.update({
        where: { id: latestModel.id },
        data: {
          accuracy: new Decimal(accuracy),
          lastUpdated: new Date(),
        },
      });
    }
  }

  async getModels() {
    return prisma.predictionModel.findMany({
      orderBy: {
        lastUpdated: "desc",
      },
    });
  }
}
