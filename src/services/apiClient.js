import { frontendConfig } from "../config/env";

const API_BASE_URL = frontendConfig.apiBaseUrl.replace(/\/+$/, "");
const API_ORIGIN = API_BASE_URL.replace(/\/api$/, "");

export const API_URL = `${API_ORIGIN}/api`;

export function apiUrl(path) {
  return `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function fetchWithCredentials(path, options = {}) {
  return fetch(apiUrl(path), {
    ...options,
    credentials: "include",
  });
}

export function createCredentialedEventSource(path) {
  return new EventSource(apiUrl(path), {
    withCredentials: true,
  });
}
