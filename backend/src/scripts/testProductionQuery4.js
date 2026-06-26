// Using global fetch
const API_BASE = "https://fxdesk-backend.onrender.com/api";

async function run() {
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
    console.error("Login failed");
    return;
  }

  const setCookie = loginRes.headers.get("set-cookie");
  const cookieHeader = setCookie ? setCookie.split(";")[0] : "";

  console.log("Server Date Header on login response:", loginRes.headers.get("date"));

  // Fetch signals
  const signalsRes = await fetch(`${API_BASE}/signals?activeOnly=true&limit=10`, {
    headers: { Cookie: cookieHeader }
  });
  const data = await signalsRes.json();
  const signals = data.signals || [];

  console.log("\nSample Active Signals Time Details:");
  for (const sig of signals) {
    console.log(`- Signal ID: ${sig._id}`);
    console.log(`  Pair: ${sig.pair} | Action: ${sig.action}`);
    console.log(`  Timestamp (field): ${sig.timestamp}`);
    console.log(`  CreatedAt (field): ${sig.createdAt}`);
    console.log(`  Freshness Score: ${sig.freshnessScore} | Weight: ${sig.freshnessWeight} | AgeMinutes: ${sig.ageMinutes}`);
    console.log(`  signalState: ${sig.signalState}`);
    console.log(`--------------------------------`);
  }
}

run().catch(console.error);
