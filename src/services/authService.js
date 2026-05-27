import { frontendConfig } from "../config/env";

const API_BASE_URL = frontendConfig.apiBaseUrl.replace(/\/+$/, "");
const API_ORIGIN = API_BASE_URL.replace(/\/api$/, "");
const AUTH_BASE_URL = `${API_ORIGIN}/api/auth`;

async function parseJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Authentication failed.");
  }

  return payload;
}

export async function login({ email, password, remember = true }) {
  const response = await fetch(`${AUTH_BASE_URL}/login`, {
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
  await fetch(`${AUTH_BASE_URL}/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export async function getCurrentUser() {
  const response = await fetch(`${AUTH_BASE_URL}/me`, {
    credentials: "include",
  });

  if (response.status === 401) {
    return null;
  }

  const payload = await parseJsonResponse(response);

  return payload.user;
}
