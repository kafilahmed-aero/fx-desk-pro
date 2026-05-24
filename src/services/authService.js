const AUTH_STORAGE_KEY = "forex-dashboard-auth";
const AUTH_SESSION_KEY = "forex-dashboard-session-auth";
const AUTH_DELAY = 700;

const fakeUser = {
  email: "trader@example.com",
  name: "FX Trader",
};

const delay = (callback) =>
  new Promise((resolve) => {
    window.setTimeout(() => resolve(callback()), AUTH_DELAY);
  });

const getStorage = (remember) => (remember ? window.localStorage : window.sessionStorage);

const parseStoredUser = (storedUser) => {
  if (!storedUser) {
    return null;
  }

  try {
    return JSON.parse(storedUser);
  } catch {
    return null;
  }
};

export const login = ({ email, password, remember = true }) =>
  delay(() => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      throw new Error("Email and password are required.");
    }

    const user = { ...fakeUser, email: trimmedEmail };
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    window.sessionStorage.removeItem(AUTH_SESSION_KEY);
    getStorage(remember).setItem(
      remember ? AUTH_STORAGE_KEY : AUTH_SESSION_KEY,
      JSON.stringify(user)
    );

    return user;
  });

export const logout = () => {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
  window.sessionStorage.removeItem(AUTH_SESSION_KEY);
};

export const getCurrentUser = () => {
  const storedUser =
    window.localStorage.getItem(AUTH_STORAGE_KEY) ||
    window.sessionStorage.getItem(AUTH_SESSION_KEY);

  return parseStoredUser(storedUser);
};

export const isAuthenticated = () => Boolean(getCurrentUser());
