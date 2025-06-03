import * as tf from '@tensorflow/tfjs';
import { FinancialTransaction, PredictionModel } from '../models/types';
import { prisma } from '../utils/prisma';

export class PredictionService {
  private model: tf.Sequential | null = null;

  private async prepareData(transactions: FinancialTransaction[], sequenceLength: number = 7) {
    const sortedData = transactions
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map(t => t.type === 'income' ? Number(t.amount) : -Number(t.amount));

    const sequences = [];
    const targets = [];

    for (let i = 0; i <= sortedData.length - sequenceLength - 1; i++) {
      sequences.push(sortedData.slice(i, i + sequenceLength));
      targets.push(sortedData[i + sequenceLength]);
    }

    return {
      sequences: tf.tensor3d(sequences.map(seq => [seq])),
      targets: tf.tensor2d(targets.map(t => [t])),
    };
  }

  private async createModel(sequenceLength: number): Promise<tf.Sequential> {
    const model = tf.sequential();

    model.add(tf.layers.lstm({
      units: 50,
      inputShape: [1, sequenceLength],
      returnSequences: false,
    }));

    model.add(tf.layers.dense({
      units: 1,
      activation: 'linear',
    }));

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'meanSquaredError',
    });

    return model;
  }
}