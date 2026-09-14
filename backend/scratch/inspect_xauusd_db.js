import "dotenv/config";
import mongoose from "mongoose";

const MONGO_URI = "mongodb://kafilahmed25_db_user:FN8dzigOsCUAVRWH@ac-g87c9lw-shard-00-00.5wjmjrg.mongodb.net:27017/?ssl=true&authSource=admin";

async function inspectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected successfully to MongoDB!");

    const db = mongoose.connection.db;

    for (const collName of ["parsed_signals", "parsedSignals"]) {
      const collection = db.collection(collName);
      const count = await collection.countDocuments();
      console.log(`\n==================================================`);
      console.log(`Collection: '${collName}' (Total documents: ${count})`);
      console.log(`==================================================`);

      if (count === 0) continue;

      const xauSignals = await collection.find({
        pair: "XAUUSD"
      }).sort({ createdAt: -1, _id: -1 }).toArray();

      console.log(`Total XAUUSD signals in '${collName}': ${xauSignals.length}`);

      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

      const activeOrPartial = xauSignals.filter(s => ["ACTIVE", "PARTIAL"].includes((s.signalState || s.signalStatus || "ACTIVE").toUpperCase()));

      const under1Hour = activeOrPartial.filter(s => new Date(s.createdAt || s.timestamp) >= oneHourAgo);
      const under6Hours = activeOrPartial.filter(s => new Date(s.createdAt || s.timestamp) >= sixHoursAgo);
      const olderThan6Hours = activeOrPartial.filter(s => new Date(s.createdAt || s.timestamp) < sixHoursAgo);

      console.log(`\n📊 ACTIVE/PARTIAL TIMEFRAME BREAKDOWN for XAUUSD:`);
      console.log(`- Active/Partial Total: ${activeOrPartial.length}`);
      console.log(`- Received in last 1 HOUR (< 60 min): ${under1Hour.length}`);
      console.log(`- Received in last 6 HOURS (< 360 min): ${under6Hours.length}`);
      console.log(`- Older than 6 hours: ${olderThan6Hours.length}`);

      console.log(`\n📋 RECENT SIGNALS IN '${collName}':`);
      xauSignals.slice(0, 50).forEach((s, idx) => {
        const time = new Date(s.createdAt || s.timestamp);
        const ageMin = Math.round((now - time) / 60000);
        const state = (s.signalState || s.signalStatus || "ACTIVE").toUpperCase();
        console.log(`${(idx + 1).toString().padStart(2, " ")}. [${(s.action || "").padEnd(4, " ")}] Age: ${ageMin.toString().padStart(4, " ")}m ago (${time.toLocaleTimeString()}) | State: ${state.padEnd(7, " ")} | Channel: @${s.channelTitle || s.channel || s.sourceChannel}`);
      });
    }

  } catch (err) {
    console.error("Error inspecting DB:", err);
  } finally {
    await mongoose.disconnect();
  }
}

inspectDB();
