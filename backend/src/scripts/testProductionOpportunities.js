const API_BASE = "https://fxdesk-backend.onrender.com/api";

async function run() {
  console.log("=== VERIFYING PRODUCTION OPPORTUNITIES API ===");
  
  // 1. Log in
  console.log("Logging into production backend...");
  const loginRes = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "kafil123@gmail.com",
      password: "A1122334455a@",
      remember: true
    })
  });

  if (!loginRes.ok) {
    console.error("Login failed!");
    return;
  }

  const setCookie = loginRes.headers.get("set-cookie");
  const cookieHeader = setCookie ? setCookie.split(";")[0] : "";
  console.log("Logged in successfully. Session cookie acquired.");

  // 2. Fetch opportunities
  console.log("Fetching active opportunities...");
  const oppRes = await fetch(`${API_BASE}/consensus/opportunities`, {
    headers: { Cookie: cookieHeader }
  });

  if (!oppRes.ok) {
    console.error("Failed to load opportunities!");
    return;
  }

  const data = await oppRes.json();
  const opportunities = data.opportunities || [];

  console.log(`\nFound ${opportunities.length} active opportunities in production consensus:`);
  
  let hasPollution = false;
  for (const opp of opportunities) {
    console.log(JSON.stringify(opp, null, 2));

    // Check for single digit values or impossible ranges
    const str = JSON.stringify(opp);
    const match = str.match(/\b([0-9]|10)(?:\.[0-9]+)?\b/);
    if (match) {
      hasPollution = true;
      console.warn("  [SUSPICIOUS] Detected invalid single-digit value:", match[0]);
    }
  }

  console.log("\n==========================================");
  if (hasPollution) {
    console.warn("Verification status: POLLUTION DETECTED IN PRODUCTION consensus.");
  } else {
    console.log("Verification status: PRODUCTION OPPORTUNITIES ARE 100% CLEAN.");
  }
}

run().catch(console.error);
