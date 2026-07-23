import fs from "fs";

function run() {
  const filePath = "C:\\Users\\Lenovo\\AppData\\Roaming\\MetaQuotes\\Terminal\\D0E8209F77C8CF37AD8BF550E51FF075\\MQL5\\logs\\20260717.log";
  
  if (!fs.existsSync(filePath)) {
    console.log("File does not exist:", filePath);
    return;
  }
  
  const content = fs.readFileSync(filePath, "utf16le");
  console.log("=== MQL5 TODAY LOGS ===");
  console.log(content);
}

run();
