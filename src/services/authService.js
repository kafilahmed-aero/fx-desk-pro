import { fetchWithCredentials } from "./apiClient";

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Authentication failed.");
  }

  return payload;
}

export async function login({ email, password, remember = true }) {
  const response = await fetchWithCredentials("/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, remember }),
  });
  const payload = await parseJsonResponse(response);

  return payload.user;
}

export async function logout() {
  await fetchWithCredentials("/auth/logout", {
    method: "POST",
  });
}

export async function getCurrentUser() {
  const response = await fetchWithCredentials("/auth/me");

  if (response.status === 401) {
    return null;
  }

  const payload = await parseJsonResponse(response);

  return payload.user;
}
