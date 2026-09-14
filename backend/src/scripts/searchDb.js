import mongoose from 'mongoose';

async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27017/forex_signals');
  const db = mongoose.connection.db;
  const cols = await db.listCollections().toArray();
  console.log('--- MongoDB Collections ---');
  console.log(cols.map((c) => c.name));

  for (const c of cols) {
    const docs = await db.collection(c.name).find({
      $or: [
        { rawText: /4034/ },
        { entry: 4034 },
        { targets: 4034 },
        { target: 4034 },
        { stopLoss: 4047 },
        { text: /4034/ },
      ],
    }).toArray();

    if (docs.length > 0) {
      console.log(`\n====================================================`);
      console.log(`MATCH FOUND IN MONGO COLLECTION: ${c.name}`);
      console.log(`====================================================`);
      console.log(JSON.stringify(docs, null, 2));
    }
  }

  process.exit(0);
}

main().catch(console.error);
