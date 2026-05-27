import { config } from "../config/env.js";
import { verifySessionToken } from "../services/authService.js";

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((cookies, cookie) => {
    const [name, ...valueParts] = cookie.trim().split("=");

    if (!name) {
      return cookies;
    }

    try {
      cookies[name] = decodeURIComponent(valueParts.join("="));
    } catch {
      cookies[name] = "";
    }
    return cookies;
  }, {});
}

function getBearerToken(header = "") {
  const [scheme, token] = header.split(" ");

  if (scheme?.toLowerCase() !== "bearer") {
    return null;
  }

  return token || null;
}

export function getTokenFromRequest(request) {
  const cookies = parseCookies(request.headers.cookie);
  const cookieToken = cookies[config.auth.cookieName];
  const bearerToken = getBearerToken(request.headers.authorization);
  const queryToken =
    typeof request.query?.token === "string" ? request.query.token : null;

  return cookieToken || bearerToken || queryToken;
}

export function requireAuth(request, response, next) {
  const user = verifySessionToken(getTokenFromRequest(request));

  if (!user) {
    return response.status(401).json({ error: "Authentication required." });
  }

  request.user = user;
  return next();
}
