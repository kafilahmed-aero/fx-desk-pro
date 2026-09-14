import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { storeParsedSignal } from '../services/parsedSignalStore.js';
dotenv.config();

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/forex_signals';
console.log('Connecting to MongoDB at:', mongoUri);

const signalsToInject = [
  { pair: 'XAUUSD', action: 'BUY', entry: 4018, stopLoss: 4010, target: 4028, rawText: 'BUY 4018', channel: 'TestChannel_A' },
  { pair: 'XAUUSD', action: 'SELL', entry: 4018, stopLoss: 4026, target: 4010, rawText: 'SELL 4018', channel: 'TestChannel_B' },
  { pair: 'XAUUSD', action: 'BUY', entry: 4015, stopLoss: 4005, target: 4025, rawText: 'BUY 4015', channel: 'TestChannel_C' },
  { pair: 'XAUUSD', action: 'SELL', entry: 4018, stopLoss: 4028, target: 4008, rawText: 'SELL 4018', channel: 'TestChannel_D' },
];

try {
  await mongoose.connect(mongoUri);

  for (let i = 0; i < signalsToInject.length; i++) {
    const s = signalsToInject[i];
    const signalObj = {
      pair: s.pair,
      symbol: s.pair,
      action: s.action,
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
      possibleDuplicate: i === 3 // Mark 4th signal as possibleDuplicate to prove Pure Message Engine policy
    };

    const res = await storeParsedSignal(signalObj);
    console.log(`✓ Signal ${String.fromCharCode(65 + i)} Injected via storeParsedSignal: ${s.action} ${s.entry} (${s.channel}) | duplicate=${res.duplicate || false}`);
  }

  console.log('\nAll 4 test signals stored via storeParsedSignal successfully!');
} catch (err) {
  console.error('Error during test signal injection:', err.message);
} finally {
  await mongoose.disconnect();
}
