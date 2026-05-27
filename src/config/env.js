const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "";

if (import.meta.env.PROD && !apiBaseUrl) {
  throw new Error("VITE_API_BASE_URL is required for production builds.");
}

export const frontendConfig = {
  apiBaseUrl: apiBaseUrl || "http://localhost:5000/api",
};
