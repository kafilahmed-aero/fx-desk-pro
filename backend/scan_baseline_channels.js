import fs from "fs";
import path from "path";

const testMessagesDir = "./test-messages";
const files = fs.readdirSync(testMessagesDir).filter(f => f.endsWith(".json") && f !== "regression-baseline.json");

const channels = new Set();

for (const file of files) {
  const filePath = path.join(testMessagesDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  for (const item of data) {
    if (item.channel) {
      channels.add(item.channel);
    }
    if (item.rawMessage && item.rawMessage.channel) {
      channels.add(item.rawMessage.channel);
    }
  }
}

console.log("Unique channels in baseline files:");
console.log([...channels]);
