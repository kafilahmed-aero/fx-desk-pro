import "dotenv/config";

async function run() {
  const API_BASE = "https://fxdesk-backend.onrender.com/api";
  console.log("Fetching live signals and consensus from Render backend...");
  
  try {
    const oppRes = await fetch(`${API_BASE}/consensus/opportunities`);
    if (oppRes.ok) {
      const opportunities = await oppRes.json();
      console.log("=== ACTIVE OPPORTUNITIES FROM LIVE BACKEND ===");
      const xau = opportunities.find(o => o.pair === "XAUUSD");
      if (xau) {
        console.log("XAUUSD Opportunity Data:", JSON.stringify(xau, null, 2));
      } else {
        console.log("All opportunities:", JSON.stringify(opportunities, null, 2));
      }
    } else {
      console.log("Failed to fetch opportunities status:", oppRes.status);
    }

    const loginRes = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "kafil123@gmail.com",
        password: "A1122334455a@",
        remember: true
      })
    });

    if (loginRes.ok) {
      const setCookie = loginRes.headers.get("set-cookie");
      const cookieHeader = setCookie ? setCookie.split(";")[0] : "";
      
      const sigRes = await fetch(`${API_BASE}/parsed-signals`, {
        headers: { Cookie: cookieHeader }
      });

      if (sigRes.ok) {
        const signals = await sigRes.json();
        const now = new Date();
        const activeXau = signals.filter(s => s.pair === "XAUUSD" && ["ACTIVE", "PARTIAL"].includes(s.signalState || s.signalStatus));
        console.log(`\nTotal Active/Partial XAUUSD signals in parsed-signals endpoint: ${activeXau.length}`);
        
        const under1Hour = activeXau.filter(s => (now - new Date(s.createdAt || s.timestamp)) <= 60 * 60 * 1000);
        const under6Hours = activeXau.filter(s => (now - new Date(s.createdAt || s.timestamp)) <= 6 * 60 * 60 * 1000);
        
        console.log(`Signals under 1 hour: ${under1Hour.length}`);
        console.log(`Signals under 6 hours: ${under6Hours.length}`);
        
        console.log("\nRecent 10 XAUUSD Signals:");
        activeXau.slice(0, 15).forEach((s, idx) => {
          const time = new Date(s.createdAt || s.timestamp);
          const ageMin = Math.round((now - time) / 60000);
          console.log(`${idx + 1}. [${s.action}] Channel: ${s.channelTitle || s.channel} | State: ${s.signalState || s.signalStatus} | Age: ${ageMin}m ago (${time.toLocaleTimeString()})`);
        });
      } else {
        console.log("Failed to fetch parsed signals status:", sigRes.status);
      }
    } else {
      console.log("Login failed status:", loginRes.status);
    }
  } catch (err) {
    console.error("API error:", err);
  }
}

run();
