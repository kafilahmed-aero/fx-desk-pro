import { useEffect, useMemo, useState } from "react";
import { ThemeContext } from "./themeContextValue";

const THEME_STORAGE_KEY = "forex-dashboard-theme";

const getStoredTheme = () => {
  if (typeof window === "undefined") {
    return "dark";
  }

  return window.localStorage.getItem(THEME_STORAGE_KEY) || "dark";
};

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getStoredTheme);
  const isDark = theme === "dark";

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark, theme]);

  const value = useMemo(
    () => ({
      theme,
      isDark,
      toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
      setTheme,
    }),
    [isDark, theme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
