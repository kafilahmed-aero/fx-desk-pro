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
        localStorage.setItem("fx_desk_user", JSON.stringify(payload.user));
        sessionStorage.removeItem("fx_desk_token");
        sessionStorage.removeItem("fx_desk_user");
      } else {
        sessionStorage.setItem("fx_desk_token", payload.token);
        sessionStorage.setItem("fx_desk_user", JSON.stringify(payload.user));
        localStorage.removeItem("fx_desk_token");
        localStorage.removeItem("fx_desk_user");
      }
    } catch (err) {
      console.warn("Storage access failed:", err);
    }
  }

  return payload.user;
}

export function getCachedUser() {
  try {
    const token = localStorage.getItem("fx_desk_token") || sessionStorage.getItem("fx_desk_token");
    const userStr = localStorage.getItem("fx_desk_user") || sessionStorage.getItem("fx_desk_user");
    if (token && userStr) {
      return JSON.parse(userStr);
    }
  } catch {}
  return null;
}

export async function logout() {
  await fetchWithCredentials("/auth/logout", {
    method: "POST",
  }).catch(() => {});
  
  try {
    localStorage.removeItem("fx_desk_token");
    localStorage.removeItem("fx_desk_user");
    sessionStorage.removeItem("fx_desk_token");
    sessionStorage.removeItem("fx_desk_user");
  } catch (err) {
    console.warn("Storage clear failed:", err);
  }
}

export async function getCurrentUser() {
  // If no token exists at all, avoid blocking network call
  const savedToken = localStorage.getItem("fx_desk_token") || sessionStorage.getItem("fx_desk_token");
  if (!savedToken) {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetchWithCredentials("/auth/me", {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.status === 401) {
      try {
        localStorage.removeItem("fx_desk_token");
        localStorage.removeItem("fx_desk_user");
        sessionStorage.removeItem("fx_desk_token");
        sessionStorage.removeItem("fx_desk_user");
      } catch (err) {
        console.warn("Storage clear failed:", err);
      }
      return null;
    }

    const payload = await parseJsonResponse(response);
    if (payload?.user) {
      try {
        localStorage.setItem("fx_desk_user", JSON.stringify(payload.user));
      } catch {}
    }
    return payload.user;
  } catch (err) {
    clearTimeout(timeoutId);
    // On timeout or network failure, keep cached user if present to prevent jarring logout
    return getCachedUser();
  }
}
