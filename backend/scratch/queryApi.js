

async function run() {
  console.log("Logging into FX Desk Pro...");
  const loginRes = await fetch("http://localhost:5000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "trader@example.com", password: "password" })
  });

  if (!loginRes.ok) {
    console.error("Login failed:", await loginRes.text());
    return;
  }

  const { token } = await loginRes.json();
  console.log("Logged in successfully. Token obtained.");

  console.log("\nFetching raw messages...");
  const rawMessagesRes = await fetch(`http://localhost:5000/api/raw-messages?token=${token}`);
  const rawMessagesData = await rawMessagesRes.json();
  const rawMessages = rawMessagesData.messages || [];
  console.log(`Total raw messages: ${rawMessages.length}`);
  
  const testMessages = rawMessages.filter(m => m.isTestSignal || m.channel === "Fx-test-feed");
  console.log(`Test feed signals count: ${testMessages.length}`);
  if (testMessages.length > 0) {
    console.log("Latest test signal:", JSON.stringify(testMessages[0], null, 2));
  }

  console.log("\nFetching parsed signals...");
  const signalsRes = await fetch(`http://localhost:5000/api/signals?token=${token}`);
  const signals = await signalsRes.json();
  console.log(`Total parsed signals: ${signals.length}`);
  console.log("All parsed signals:", JSON.stringify(signals, null, 2));
}

run().catch(console.error);
