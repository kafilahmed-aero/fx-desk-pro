import 'dotenv/config';
import mongoose from 'mongoose';

async function inspectDatabase() {
  console.log('====================================================');
  console.log('  Historical Database & Price History Audit        ');
  console.log('====================================================\n');

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) return;

  try {
    await mongoose.connect(mongoUri);

    // Query parsedSignals
    const ParsedSignalCol = mongoose.connection.db.collection('parsedSignals');
    const totalCount = await ParsedSignalCol.countDocuments();
    const xauCount = await ParsedSignalCol.countDocuments({ $or: [{ pair: 'XAUUSD' }, { symbol: 'XAUUSD' }, { symbol: 'GOLD' }] });
    console.log(`Total ParsedSignals in DB: ${totalCount}`);
    console.log(`Total XAUUSD Signals in DB: ${xauCount}`);

    const sampleSignal = await ParsedSignalCol.findOne({ $or: [{ pair: 'XAUUSD' }, { symbol: 'XAUUSD' }] });
    console.log('\nSample XAUUSD ParsedSignal:');
    console.log(JSON.stringify(sampleSignal, null, 2));

    // Query marketPrices
    const MarketPricesCol = mongoose.connection.db.collection('marketPrices');
    const marketPricesCount = await MarketPricesCol.countDocuments();
    console.log(`\nTotal marketPrices Documents in DB: ${marketPricesCount}`);

    const samplePrice = await MarketPricesCol.findOne();
    console.log('\nSample marketPrices Document:');
    console.log(JSON.stringify(samplePrice, null, 2));

    await mongoose.disconnect();
  } catch (err) {
    console.error('Audit Error:', err.message);
  }
}

inspectDatabase();
