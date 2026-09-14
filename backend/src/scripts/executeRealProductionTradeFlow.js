import 'dotenv/config';
import mongoose from 'mongoose';

async function executeLiveTradeFlow() {
  console.log('====================================================');
  console.log('  STEP 2: Executing Live Production Trade Signal    ');
  console.log('====================================================\n');

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) return;

  try {
    await mongoose.connect(mongoUri);

    const { processRawMessage } = await import('../services/signalProcessingService.js');

    const msgId = Date.now();
    const rawSignal = {
      messageId: msgId,
      channel: 'GOLD_SURE_SIGNALS',
      channelTitle: 'GOLD SURE SIGNALS',
      text: `GOLD BUY NOW @ 4075 - 4080\n🔴SL: 4060\n🔰TP1: 4085\n🔰TP2: 4095`,
      date: new Date(),
    };

    console.log(`Ingesting Live Signal to Production Pipeline:\n"${rawSignal.text}"\n`);

    const result = await processRawMessage(rawSignal);
    if (result.parsedSignal) {
      console.log(`✓ Stored Live Signal ID: ${result.parsedSignal._id}`);
      console.log(`  MessageKey: GOLD_SURE_SIGNALS:${msgId}`);
      console.log(`  Pair: ${result.parsedSignal.pair} | Action: ${result.parsedSignal.action} | Entry: ${result.parsedSignal.entry}`);
    } else {
      console.error('Failed to parse signal.');
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Execution Error:', err.message);
  }
}

executeLiveTradeFlow();
