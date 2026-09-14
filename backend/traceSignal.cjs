require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  console.log('=== RECENT 10 SIGNALS IN PARSED_SIGNALS ===');
  const recent = await db.collection('parsed_signals').find({}).sort({ _id: -1 }).limit(10).toArray();

  for (const s of recent) {
    console.log('--------------------------------------------------');
    console.log('ID:', s._id);
    console.log('Channel:', s.channel || s.channelTitle);
    console.log('Action:', s.action || s.bias);
    console.log('Pair:', s.pair);
    console.log('Entry:', s.entry);
    console.log('TPs:', s.targets);
    console.log('SL:', s.stopLoss);
    console.log('Created At:', s.createdAt || s.timestamp);
    console.log('Raw Text:', s.rawText);
  }

  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
