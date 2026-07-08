import { frontendConfig } from "../config/env";

const API_BASE_URL = frontendConfig.apiBaseUrl.replace(/\/+$/, "");
const API_ORIGIN = API_BASE_URL.replace(/\/api$/, "");

export const API_URL = `${API_ORIGIN}/api`;

export function apiUrl(path) {
  return `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function getSavedToken() {
  try {
    return localStorage.getItem("fx_desk_token") || sessionStorage.getItem("fx_desk_token");
  } catch {
    return null;
  }
}

export function fetchWithCredentials(path, options = {}) {
  const headers = { ...options.headers };
  const token = getSavedToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return fetch(apiUrl(path), {
    ...options,
    headers,
    credentials: "include",
  });
}

export function createCredentialedEventSource(path) {
  const token = getSavedToken();
  const url = token
    ? `${apiUrl(path)}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
    : apiUrl(path);

  return new EventSource(url, {
    withCredentials: true,
  });
}
