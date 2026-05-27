import { config } from "../config/env.js";
import {
  authenticateUser,
  createSessionToken,
  verifySessionToken,
} from "../services/authService.js";
import { getTokenFromRequest } from "../middleware/authMiddleware.js";
import { buildSessionCookieOptions } from "../config/sessionCookie.js";

function setSessionCookie(response, token, maxAgeSeconds) {
  response.setHeader(
    "Set-Cookie",
    `${config.auth.cookieName}=${encodeURIComponent(token)}; ${buildSessionCookieOptions(
      maxAgeSeconds
    )}`
  );
}

function clearSessionCookie(response) {
  response.setHeader(
    "Set-Cookie",
    `${config.auth.cookieName}=; ${buildSessionCookieOptions(0)}`
  );
}

export function loginController(request, response) {
  const { email = "", password = "", remember = true } = request.body || {};

  if (!email.trim() || !password) {
    return response.status(400).json({ error: "Email and password are required." });
  }

  const user = authenticateUser(email, password);

  if (!user) {
    return response.status(401).json({ error: "Invalid email or password." });
  }

  const session = createSessionToken(user, Boolean(remember));
  setSessionCookie(response, session.token, session.maxAgeSeconds);

  return response.json({ user });
}

export function logoutController(_request, response) {
  clearSessionCookie(response);
  return response.status(204).send();
}

export function meController(request, response) {
  const user = verifySessionToken(getTokenFromRequest(request));

  if (!user) {
    clearSessionCookie(response);
    return response.status(401).json({ error: "Authentication required." });
  }

  return response.json({ user });
}
