import 'dotenv/config';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

async function traceExactSignal() {
  console.log('====================================================');
  console.log('  Tracing Exact Telegram Signal from Screenshot     ');
  console.log('====================================================\n');

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) return;

  try {
    await mongoose.connect(mongoUri);
    const db = mongoose.connection.db;

    // Search parsedSignals in MongoDB Atlas
    const ParsedSignalCol = db.collection('parsedSignals');
    const parsedSignal = await ParsedSignalCol.findOne({
      $or: [
        { rawText: { $regex: '4087', $options: 'i' } },
        { rawText: { $regex: '4091', $options: 'i' } },
        { rawText: { $regex: 'LIMITES', $options: 'i' } },
        { rawText: { $regex: '4083.*4079', $options: 'i' } },
      ],
    });

    console.log('STAGE 3: MongoDB parsedSignals Query Result:');
    if (parsedSignal) {
      console.log(JSON.stringify(parsedSignal, null, 2));
    } else {
      console.log('❌ NOT FOUND in parsedSignals collection in MongoDB Atlas.');
    }

    // Search rawMessages_archive.json
    const archivePath = 'C:\\Users\\Lenovo\\auto_trade\\archive\\rawMessages_archive.json';
    if (fs.existsSync(archivePath)) {
      const rawData = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
      const rawMatch = rawData.find(
        (m) =>
          (m.text && m.text.includes('4087')) ||
          (m.text && m.text.includes('LIMITES')) ||
          (m.text && m.text.includes('4083__4079')) ||
          (m.channelTitle && m.channelTitle.includes('GOLD SURE'))
      );

      console.log('\nSTAGE 1: Telegram Ingestion rawMessages Archive Query Result:');
      if (rawMatch) {
        console.log(JSON.stringify(rawMatch, null, 2));
      } else {
        console.log('❌ NOT FOUND in rawMessages archive.');
      }
    }

    // Check list of Telegram channels subscribed/joined in system
    console.log('\nChecking subscribed Telegram channels...');
    const channels = await db.collection('channelPerformance').find({}).toArray();
    const goldSureChannel = channels.find((c) => (c.channelName || c.channel || '').toLowerCase().includes('gold sure'));
    console.log(`Channel "GOLD SURE SIGNALS" present in monitored channels database: ${goldSureChannel ? 'YES' : 'NO'}`);
    if (goldSureChannel) {
      console.log(JSON.stringify(goldSureChannel, null, 2));
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Trace Error:', err.message);
  }
}

traceExactSignal();
