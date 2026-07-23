import fs from "fs";
import path from "path";

function search(file, query) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  lines.forEach((line, index) => {
    if (line.toLowerCase().includes(query.toLowerCase())) {
      console.log(`${path.basename(file)}:${index + 1}: ${line.trim()}`);
    }
  });
}

const dir = "c:\\Users\\Lenovo\\forex-dashboard-demo\\backend\\node_modules\\telegram\\client";
fs.readdirSync(dir).forEach(file => {
  if (file.endsWith(".js")) {
    search(path.join(dir, file), "connect");
  }
});
