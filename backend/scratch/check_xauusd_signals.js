import "dotenv/config";
import mongoose from "mongoose";

const MONGO_URI = process.env.MONGODB_URI || "mongodb+srv://kafilahmedaero:Kabir123%40@forex-signals.yxt4o.mongodb.net/forex-signals?retryWrites=true&w=majority";

async function checkXAUUSDSignals() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB.");

    const db = mongoose.connection.db;
    const collection = db.collection("parsedsignals");

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

    const xauSignals = await collection.find({
      pair: "XAUUSD",
      signalState: { $in: ["ACTIVE", "PARTIAL"] }
    }).sort({ createdAt: -1 }).toArray();

    console.log(`Total ACTIVE/PARTIAL XAUUSD signals in DB: ${xauSignals.length}`);

    const under1Hour = xauSignals.filter(s => new Date(s.createdAt || s.timestamp) >= oneHourAgo);
    const under6Hours = xauSignals.filter(s => new Date(s.createdAt || s.timestamp) >= sixHoursAgo);

    console.log(`Active signals created in last 1 HOUR (< 60 min): ${under1Hour.length}`);
    console.log(`Active signals created in last 6 HOURS (< 360 min): ${under6Hours.length}`);

    console.log("\nTimestamps breakdown of active/partial XAUUSD signals:");
    xauSignals.slice(0, 50).forEach((s, idx) => {
      const time = new Date(s.createdAt || s.timestamp);
      const ageMinutes = Math.round((now - time) / 60000);
      console.log(`${idx + 1}. [${s.action}] Channel: @${s.channelTitle || s.channel} | State: ${s.signalState} | Age: ${ageMinutes}m ago (${time.toISOString()})`);
    });

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

checkXAUUSDSignals();
