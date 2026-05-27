import crypto from "crypto";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

const TOKEN_VERSION = 1;
const AUTH_DEBUG_ENABLED = process.env.AUTH_DEBUG_LOGIN === "true";

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function base64UrlDecode(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function sign(value) {
  return crypto
    .createHmac("sha256", config.auth.jwtSecret)
    .update(value)
    .digest("base64url");
}

function safeCompare(value, expectedValue) {
  const valueHash = crypto.createHash("sha256").update(value).digest();
  const expectedHash = crypto
    .createHash("sha256")
    .update(expectedValue)
    .digest();

  return crypto.timingSafeEqual(valueHash, expectedHash);
}

function sanitizeUser(user) {
  return {
    email: user.email,
    name: user.name,
  };
}

function logAuthDebug(details) {
  if (AUTH_DEBUG_ENABLED) {
    logger.info("auth.login_debug", details);
  }
}

export function authenticateUser(email, password) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const submittedPassword = String(password || "");
  const envEmail = String(process.env.AUTH_EMAIL || "").trim().toLowerCase();
  const envPasswordExists = Boolean(process.env.AUTH_PASSWORD);
  const user = config.auth.users.find(
    (configuredUser) => configuredUser.email === normalizedEmail
  );
  const emailMatches = Boolean(user);
  const envEmailMatches = Boolean(envEmail && normalizedEmail === envEmail);
  const passwordMatches = Boolean(user && safeCompare(submittedPassword, user.password));

  logAuthDebug({
    authEmailEnvExists: Boolean(process.env.AUTH_EMAIL),
    authPasswordEnvExists: envPasswordExists,
    configuredUserCount: config.auth.users.length,
    submittedEmailMatchesConfiguredUser: emailMatches,
    submittedEmailMatchesAuthEmailEnv: envEmailMatches,
    passwordComparisonSucceeded: passwordMatches,
  });

  if (!user || !passwordMatches) {
    return null;
  }

  return sanitizeUser(user);
}

export function createSessionToken(user, remember = true) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresInSeconds = remember ? 60 * 60 * 24 * 7 : 60 * 60 * 12;
  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const payload = {
    iss: config.auth.tokenIssuer,
    sub: user.email,
    name: user.name,
    iat: issuedAt,
    exp: issuedAt + expiresInSeconds,
    ver: TOKEN_VERSION,
  };
  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(payload);
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  return {
    token: `${unsignedToken}.${sign(unsignedToken)}`,
    maxAgeSeconds: expiresInSeconds,
  };
}

export function verifySessionToken(token) {
  if (!token) {
    return null;
  }

  const tokenParts = token.split(".");

  if (tokenParts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, signature] = tokenParts;
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  if (!safeCompare(signature, sign(unsignedToken))) {
    return null;
  }

  try {
    const header = base64UrlDecode(encodedHeader);
    const payload = base64UrlDecode(encodedPayload);
    const now = Math.floor(Date.now() / 1000);

    if (
      header.alg !== "HS256" ||
      header.typ !== "JWT" ||
      payload.iss !== config.auth.tokenIssuer ||
      payload.ver !== TOKEN_VERSION ||
      !payload.sub ||
      payload.exp <= now
    ) {
      return null;
    }

    return {
      email: payload.sub,
      name: payload.name || "FX Trader",
    };
  } catch {
    return null;
  }
}
