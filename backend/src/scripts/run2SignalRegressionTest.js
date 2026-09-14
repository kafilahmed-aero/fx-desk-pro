import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { storeParsedSignal } from '../services/parsedSignalStore.js';
dotenv.config();

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/forex_signals';
console.log('Connecting to MongoDB at:', mongoUri);

const regressionSignals = [
  { pair: 'XAUUSD', action: 'SELL', entry: 4018, stopLoss: 4028, target: 4008, rawText: 'SELL 4018', channel: 'Regression_Signal_1' },
  { pair: 'XAUUSD', action: 'SELL', entry: 4032, stopLoss: 4043, target: 4027, rawText: 'SELL 4032', channel: 'Regression_Signal_2' },
];

try {
  await mongoose.connect(mongoUri);

  for (let i = 0; i < regressionSignals.length; i++) {
    const s = regressionSignals[i];
    const signalObj = {
      pair: s.pair,
      symbol: s.pair,
      action: s.action,
      bias: 'BEARISH',
      entry: s.entry,
      stopLoss: s.stopLoss,
      target: s.target,
      targets: [s.target],
      signalStatus: 'ACTIVE',
      signalState: 'ACTIVE',
      extractionConfidence: 1,
      classification: 'NEW_SIGNAL',
      parserClassification: 'NEW_SIGNAL',
      createdAt: new Date(),
      timestamp: new Date().toISOString(),
      rawText: s.rawText,
      channel: s.channel,
      messageId: Math.floor(Date.now() / 1000) + i,
      possibleDuplicate: false,
    };

    const res = await storeParsedSignal(signalObj);
    console.log(`✓ Regression Signal ${i + 1} Injected: SELL ${s.entry} (${s.channel})`);
  }

  console.log('\nBoth regression signals injected successfully!');
} catch (err) {
  console.error('Error during regression test signal injection:', err.message);
} finally {
  await mongoose.disconnect();
}
