import { frontendConfig } from "../config/env";

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Authentication failed.");
  }

  return payload;
}

export async function login({ email, password, remember = true }) {
  const response = await fetch(`${frontendConfig.apiBaseUrl}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, remember }),
  });
  const payload = await parseJsonResponse(response);

  return payload.user;
}

export async function logout() {
  await fetch(`${frontendConfig.apiBaseUrl}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export async function getCurrentUser() {
  const response = await fetch(`${frontendConfig.apiBaseUrl}/auth/me`, {
    credentials: "include",
  });

  if (response.status === 401) {
    return null;
  }

  const payload = await parseJsonResponse(response);

  return payload.user;
}
