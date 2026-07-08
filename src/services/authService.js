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

  if (payload.token) {
    try {
      if (remember) {
        localStorage.setItem("fx_desk_token", payload.token);
        sessionStorage.removeItem("fx_desk_token");
      } else {
        sessionStorage.setItem("fx_desk_token", payload.token);
        localStorage.removeItem("fx_desk_token");
      }
    } catch (err) {
      console.warn("Storage access failed:", err);
    }
  }

  return payload.user;
}

export async function logout() {
  await fetchWithCredentials("/auth/logout", {
    method: "POST",
  }).catch(() => {});
  
  try {
    localStorage.removeItem("fx_desk_token");
    sessionStorage.removeItem("fx_desk_token");
  } catch (err) {
    console.warn("Storage clear failed:", err);
  }
}

export async function getCurrentUser() {
  const response = await fetchWithCredentials("/auth/me");

  if (response.status === 401) {
    try {
      localStorage.removeItem("fx_desk_token");
      sessionStorage.removeItem("fx_desk_token");
    } catch (err) {
      console.warn("Storage clear failed:", err);
    }
    return null;
  }

  const payload = await parseJsonResponse(response);

  return payload.user;
}
