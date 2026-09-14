import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/forex_signals';
console.log('Connecting to MongoDB at:', mongoUri);

try {
  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  const newSignal = {
    pair: 'XAUUSD',
    action: 'BUY',
    entry: 4028.00,
    stopLoss: 4015.00,
    target: 4035.00,
    targets: [4035.00],
    signalStatus: 'ACTIVE',
    signalState: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    rawText: '🚨XAUUSD BUY 4028.00\n\nTP¹: 4035.00\nSL: 4015.00',
    channel: 'goldfree8361',
    messageId: Math.floor(Date.now() / 1000)
  };

  const res = await db.collection('parsed_signals').insertOne(newSignal);
  console.log('✓ [SUCCESS] Injected NEW live signal into MongoDB!');
  console.log('  Signal ID:', res.insertedId.toString());
  console.log('  CreatedAt:', newSignal.createdAt.toISOString());
} catch (err) {
  console.error('Error inserting signal:', err.message);
} finally {
  await mongoose.disconnect();
}
