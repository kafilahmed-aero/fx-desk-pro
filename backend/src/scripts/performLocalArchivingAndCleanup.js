import 'dotenv/config';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

const ARCHIVE_DIR = 'C:\\Users\\Lenovo\\auto_trade\\archive';

async function performOptimization() {
  console.log('====================================================');
  console.log(' MongoDB Atlas Free Tier Archiving & Cleanup Engine ');
  console.log('====================================================\n');

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI missing!');
    return;
  }

  // Ensure archive directory exists
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    console.log(`📁 Created Local Archive Directory: ${ARCHIVE_DIR}`);
  }

  try {
    await mongoose.connect(mongoUri);
    console.log('✓ Successfully connected to MongoDB Atlas.\n');
    const db = mongoose.connection.db;

    // 1. Collections to fully archive locally and drop from Atlas
    const collectionsToDrop = [
      'rawMessages',
      'aiDecisionValidations',
      'airecommendationsnapshots',
      'validationreconciliationlogs',
      'phoenixRecoveryAudit',
      'quarantinedorphans',
      'phoenixModelMetadata',
      'validationchannelstats',
      'signalvalidationcontexts',
      'phoenixTradeFeature',
      'phoenixTradeMemory',
    ];

    console.log('--- PHASE 1: Archiving & Dropping Non-Essential Collections ---');
    for (const colName of collectionsToDrop) {
      const col = db.collection(colName);
      const count = await col.countDocuments();

      if (count > 0) {
        console.log(`📦 Archiving ${count} documents from collection "${colName}"...`);
        const docs = await col.find({}).toArray();
        const filePath = path.join(ARCHIVE_DIR, `${colName}_archive.json`);
        fs.writeFileSync(filePath, JSON.stringify(docs, null, 2));
        console.log(`   └─ Saved to: ${filePath}`);

        await col.drop();
        console.log(`   └─ Dropped collection "${colName}" from MongoDB Atlas.`);
      } else {
        // Drop empty collection if it exists
        const exists = await db.listCollections({ name: colName }).hasNext();
        if (exists) {
          await col.drop();
          console.log(`   └─ Dropped empty collection "${colName}" from MongoDB Atlas.`);
        }
      }
    }

    // 2. Prune historical parsedSignals (keep active signals and recent signals)
    console.log('\n--- PHASE 2: Archiving & Pruning Historical ParsedSignals ---');
    const ParsedSignalCol = db.collection('parsedSignals');
    const totalSignals = await ParsedSignalCol.countDocuments();
    console.log(`Total ParsedSignals before cleanup: ${totalSignals}`);

    // Define active / retention criteria
    const cutoffDate = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48 hours
    const activeQuery = {
      $or: [
        { signalState: 'ACTIVE' },
        { signalState: 'PARTIAL' },
        { createdAt: { $gte: cutoffDate } },
        { isTestSignal: true },
        { outcomeCategory: { $exists: true, $ne: null } },
      ],
    };

    const historicalQuery = {
      $nor: [
        { signalState: 'ACTIVE' },
        { signalState: 'PARTIAL' },
        { createdAt: { $gte: cutoffDate } },
        { isTestSignal: true },
        { outcomeCategory: { $exists: true, $ne: null } },
      ],
    };

    const historicalCount = await ParsedSignalCol.countDocuments(historicalQuery);
    console.log(`Historical signals eligible for local archiving: ${historicalCount}`);

    if (historicalCount > 0) {
      const historicalDocs = await ParsedSignalCol.find(historicalQuery).toArray();
      const signalArchivePath = path.join(ARCHIVE_DIR, 'parsedSignals_historical_archive.json');
      fs.writeFileSync(signalArchivePath, JSON.stringify(historicalDocs, null, 2));
      console.log(`📦 Saved ${historicalCount} historical signals to: ${signalArchivePath}`);

      const deleteRes = await ParsedSignalCol.deleteMany(historicalQuery);
      console.log(`✓ Deleted ${deleteRes.deletedCount} historical signals from MongoDB Atlas.`);
    }

    const remainingSignals = await ParsedSignalCol.countDocuments();
    console.log(`✓ Remaining ParsedSignals in MongoDB Atlas: ${remainingSignals}`);

    // 3. Final Storage Stats Audit
    console.log('\n--- PHASE 3: Optimized Storage Summary ---');
    const remainingCols = await db.listCollections().toArray();
    let finalStorageBytes = 0;
    let finalDocs = 0;
    const finalAudit = [];

    for (const c of remainingCols) {
      const stats = await db.command({ collStats: c.name }).catch(() => ({ count: 0, size: 0, storageSize: 0 }));
      const docs = stats.count || 0;
      const stBytes = stats.storageSize || stats.size || 0;

      finalStorageBytes += stBytes;
      finalDocs += docs;

      finalAudit.push({
        collection: c.name,
        documents: docs,
        storageKB: (stBytes / 1024).toFixed(2),
      });
    }

    console.table(finalAudit);
    console.log(`\nFinal Total Documents in MongoDB: ${finalDocs}`);
    console.log(`Final Database Storage Size: ${(finalStorageBytes / (1024 * 1024)).toFixed(2)} MB`);

    await mongoose.disconnect();
  } catch (err) {
    console.error('Optimization Error:', err.message);
  }
}

performOptimization();
