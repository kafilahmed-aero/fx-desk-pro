const AUTH_STORAGE_KEY = "forex-dashboard-auth";
const AUTH_DELAY = 700;

const fakeUser = {
  email: "trader@example.com",
  name: "FX Trader",
};

const delay = (callback) =>
  new Promise((resolve) => {
    window.setTimeout(() => resolve(callback()), AUTH_DELAY);
  });

export const login = ({ email, password }) =>
  delay(() => {
    if (!email || !password) {
      throw new Error("Email and password are required.");
    }

    const user = { ...fakeUser, email };
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));

    return user;
  });

export const logout = () => {
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
};

export const getCurrentUser = () => {
  const storedUser = window.localStorage.getItem(AUTH_STORAGE_KEY);
  return storedUser ? JSON.parse(storedUser) : null;
};

export const isAuthenticated = () => Boolean(getCurrentUser());
