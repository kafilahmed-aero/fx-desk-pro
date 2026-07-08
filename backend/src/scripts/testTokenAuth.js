import "dotenv/config";

const BACKEND_URL = "http://localhost:5000/api";

async function main() {
  console.log("1. Logging in...");
  let email = "KAFIL123@GMAIL.COM";
  let password = "A1122334455a@";

  let loginRes = await fetch(`${BACKEND_URL}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      password,
      remember: true
    })
  });

  if (loginRes.status === 401) {
    console.log("Production credentials returned 401, trying local fallback credentials...");
    email = "trader@example.com";
    password = "password";
    loginRes = await fetch(`${BACKEND_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        password,
        remember: true
      })
    });
  }

  console.log(`Login status: ${loginRes.status}`);
  const loginData = await loginRes.json();
  if (!loginRes.ok) {
    console.error("Login failed:", loginData);
    process.exit(1);
  }

  const token = loginData.token;
  if (!token) {
    console.error("No token returned in response body!");
    process.exit(1);
  }
  console.log("Token successfully returned!");

  const testEndpoint = async (path) => {
    console.log(`\nFetching ${path} with Bearer token...`);
    const res = await fetch(`${BACKEND_URL}${path}`, {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });
    console.log(`Status: ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      console.log(`Success! Keys returned: ${Object.keys(data).join(", ")}`);
    } else {
      console.error(`Failed:`, data);
    }
  };

  await testEndpoint("/system/health");
  await testEndpoint("/system/metrics");
  await testEndpoint("/system/parser");
}

main().catch(console.error);
