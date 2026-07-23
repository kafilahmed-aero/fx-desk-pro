import dns from "dns";
import net from "net";

const domains = [
  "api.telegram.org",
  "web.telegram.org",
  "pluto.web.telegram.org",
  "venus.web.telegram.org",
  "aurora.web.telegram.org",
  "vesta.web.telegram.org",
  "flora.web.telegram.org"
];

const dcs = [
  { id: 1, ip: "149.154.175.50" },
  { id: 2, ip: "149.154.167.51" },
  { id: 3, ip: "149.154.175.100" },
  { id: 4, ip: "149.154.167.91" },
  { id: 5, ip: "91.108.56.161" }
];

async function resolveDomain(domain) {
  return new Promise((resolve) => {
    dns.resolve4(domain, (err, addresses) => {
      if (err) {
        resolve({ domain, success: false, error: err.message });
      } else {
        resolve({ domain, success: true, addresses });
      }
    });
  });
}

async function testTcp(ip, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let completed = false;

    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        socket.destroy();
        resolve({ success: false, error: "timeout" });
      }
    }, 2000); // 2 second timeout

    socket.connect(port, ip, () => {
      completed = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ success: true });
    });

    socket.on("error", (err) => {
      completed = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ success: false, error: err.message });
    });
  });
}

async function run() {
  console.log("=== DNS RESOLUTION ===");
  for (const d of domains) {
    const res = await resolveDomain(d);
    if (res.success) {
      console.log(`${res.domain} -> ${res.addresses.join(", ")}`);
    } else {
      console.log(`${res.domain} -> FAILED: ${res.error}`);
    }
  }

  console.log("\n=== TCP CONNECTIVITY TO TELEGRAM DCs ===");
  for (const dc of dcs) {
    console.log(`\nTesting DC ${dc.id} (IP: ${dc.ip})`);
    
    // Test Port 80
    const res80 = await testTcp(dc.ip, 80);
    console.log(`- Port 80:  ${res80.success ? "SUCCESS" : "FAILED (" + res80.error + ")"}`);

    // Test Port 443
    const res443 = await testTcp(dc.ip, 443);
    console.log(`- Port 443: ${res443.success ? "SUCCESS" : "FAILED (" + res443.error + ")"}`);
  }
}

run().catch(console.error);
