import fs from "fs";
import path from "path";
import os from "os";

function findLogFiles(dir, fileList = []) {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch (e) {
        continue;
      }
      if (stat.isDirectory()) {
        // Skip some big non-mql5 directories to save time
        if (file.toLowerCase() === "node_modules" || file.toLowerCase() === ".git") {
          continue;
        }
        findLogFiles(filePath, fileList);
      } else if (filePath.endsWith(".log") && (filePath.toLowerCase().includes("mql5") || filePath.toLowerCase().includes("metaquotes") || filePath.toLowerCase().includes("terminal"))) {
        fileList.push(filePath);
      }
    }
  } catch (e) {
    // Ignore permission errors or missing dirs
  }
  return fileList;
}

const appData = path.join(os.homedir(), "AppData");
console.log("Searching in:", appData);
const logs = findLogFiles(appData);
console.log(`Found ${logs.length} potential MT5 log files:`);
logs.forEach(f => console.log(f));
