import fs from "fs";
import path from "path";
import { parseSignalMessage } from "../parsers/signalParser.js";
import { classifyMessage } from "../parsers/noiseFilter.js";

const testMessagesDir = "c:/Users/Lenovo/forex-dashboard-demo/backend/test-messages";
const files = [
  "clean-complete-signals.json",
  "market-commentary-signals.json",
  "partial-incomplete-signals.json",
  "short-fast-signals.json",
  "duplicate-signals.json",
  "promo-noise-signals.json",
  "update-result-signals.json"
];

for (const file of files) {
  const filePath = path.join(testMessagesDir, file);
  if (!fs.existsSync(filePath)) continue;

  const content = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(content);
  
  let matchCount = 0;
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    const text = item.text || item.rawText || "";
    const channel = item.channel || "unknown";
    const timestamp = item.timestamp || item.createdAt || "unknown";
    
    const classification = classifyMessage({ text });
    if (["NEW_SIGNAL", "UPDATE_SIGNAL", "RESULT_SIGNAL"].includes(classification.classification)) {
      const parsed = parseSignalMessage({ text, channel, timestamp }, classification.classification);
      
      if (parsed && parsed.entryRange && parsed.entryRange.length === 2) {
        const min = parsed.entryRange[0];
        const max = parsed.entryRange[1];
        if (max - min > 1000) {
          matchCount++;
          console.log(`MATCH in file: ${file} at index ${i}`);
          console.log(JSON.stringify({
            channel,
            timestamp,
            rawText: text,
            entry: parsed.entry,
            entryRange: parsed.entryRange,
            targets: parsed.targets,
            stopLoss: parsed.stopLoss
          }, null, 2));
        }
      }
    }
  }
}
console.log("Fixture scan complete.");
