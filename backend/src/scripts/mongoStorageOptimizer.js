import 'dotenv/config';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';

async function auditStorage() {
  console.log('====================================================');
  console.log('  MongoDB Atlas Free Tier Storage Audit            ');
  console.log('====================================================\n');

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('MONGODB_URI is missing in .env!');
    return;
  }

  try {
    await mongoose.connect(mongoUri);
    console.log('✓ Successfully connected to MongoDB Atlas.\n');

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();

    const auditResults = [];
    let totalBytes = 0;
    let totalDocs = 0;

    for (const colInfo of collections) {
      const name = colInfo.name;
      const stats = await db.command({ collStats: name }).catch(() => ({ count: 0, size: 0, storageSize: 0 }));
      const docCount = stats.count || 0;
      const sizeBytes = stats.size || 0;
      const storageBytes = stats.storageSize || 0;

      totalBytes += storageBytes || sizeBytes;
      totalDocs += docCount;

      let required = 'YES';
      let purpose = 'Core Production Data';

      if (
        name.toLowerCase().includes('validation') ||
        name.toLowerCase().includes('phoenix') ||
        name.toLowerCase().includes('orphan') ||
        name.toLowerCase().includes('snapshot') ||
        name.toLowerCase().includes('decision')
      ) {
        required = 'NO';
        purpose = 'Diagnostic / Legacy Experiment Logs';
      } else if (name === 'rawMessages') {
        required = 'NO (Can archive locally)';
        purpose = 'Raw Telegram Message Ingestion Dump';
      } else if (name === 'parsedSignals') {
        required = 'PARTIAL (Keep active/completed live trades; archive historical)';
        purpose = 'Parsed Signals & Live Signals';
      }

      auditResults.push({
        name,
        docCount,
        sizeKB: (sizeBytes / 1024).toFixed(2),
        storageKB: (storageBytes / 1024).toFixed(2),
        required,
        purpose,
      });
    }

    console.table(auditResults);
    console.log(`\nTotal Database Documents: ${totalDocs}`);
    console.log(`Total Database Storage Size: ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`);

    await mongoose.disconnect();
  } catch (err) {
    console.error('Audit Exception:', err.message);
  }
}

auditStorage();
