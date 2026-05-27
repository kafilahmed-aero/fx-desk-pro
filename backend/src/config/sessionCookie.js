import { config } from "./env.js";

const productionClientUrl = "https://fx-desk-pro.vercel.app";

function envList(value = "") {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isRenderRuntime() {
  return (
    process.env.RENDER === "true" ||
    Boolean(process.env.RENDER_EXTERNAL_URL) ||
    Boolean(process.env.RENDER_SERVICE_ID) ||
    Boolean(process.env.RENDER_SERVICE_NAME)
  );
}

function hasProductionClientOrigin() {
  return envList(process.env.CLIENT_URL).includes(productionClientUrl);
}

function shouldUseProductionCookieConfig() {
  return config.isProduction || isRenderRuntime() || hasProductionClientOrigin();
}

export function getSessionCookieConfig() {
  const useProductionCookieConfig = shouldUseProductionCookieConfig();

  return {
    httpOnly: true,
    path: "/",
    sameSite: useProductionCookieConfig ? "None" : "Lax",
    secure: useProductionCookieConfig,
    useProductionCookieConfig,
  };
}

export function buildSessionCookieOptions(maxAgeSeconds) {
  const cookieConfig = getSessionCookieConfig();
  const options = [
    "HttpOnly",
    `Path=${cookieConfig.path}`,
    `SameSite=${cookieConfig.sameSite}`,
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (cookieConfig.secure) {
    options.push("Secure");
  }

  return options.join("; ");
}

export function getSessionCookieStartupLogDetails() {
  const cookieConfig = getSessionCookieConfig();

  return {
    nodeEnv: config.nodeEnv,
    renderRuntime: isRenderRuntime(),
    authCookieName: config.auth.cookieName,
    sameSite: cookieConfig.sameSite,
    secure: cookieConfig.secure,
    useProductionCookieConfig: cookieConfig.useProductionCookieConfig,
  };
}
