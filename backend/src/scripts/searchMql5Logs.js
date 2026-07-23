import fs from "fs";

function run() {
  const files = [
    "C:\\Users\\Lenovo\\AppData\\Roaming\\MetaQuotes\\Terminal\\D0E8209F77C8CF37AD8BF550E51FF075\\MQL5\\logs\\20260717.log",
    "C:\\Users\\Lenovo\\AppData\\Roaming\\MetaQuotes\\Terminal\\D0E8209F77C8CF37AD8BF550E51FF075\\logs\\20260717.log"
  ];
  
  files.forEach(filePath => {
    if (!fs.existsSync(filePath)) {
      console.log("File does not exist:", filePath);
      return;
    }
    
    console.log(`=== SEARCHING FILE: ${filePath} ===`);
    const content = fs.readFileSync(filePath, "utf16le");
    const lines = content.split("\n");
    lines.forEach(line => {
      if (
        line.includes("OPEN_ORDER") ||
        line.includes("189206") ||
        line.includes("magic") ||
        line.includes("Magic") ||
        line.includes("ticket") ||
        line.includes("Ticket")
      ) {
        console.log(line);
      }
    });
  });
}

run();
