import { useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  Bell,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings as SettingsIcon,
  Signal,
  Sun,
  X,
  UserCircle,
} from "lucide-react";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import Analytics from "./pages/Analytics";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Settings from "./pages/Settings";
import Signals from "./pages/Signals";
import { ThemeProvider } from "./context/ThemeContext";
import { useTheme } from "./context/useTheme";
import { getCurrentUser, logout } from "./services/authService";

const navigationItems = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Signals", path: "/signals", icon: Signal },
  { label: "Analytics", path: "/analytics", icon: BarChart3 },
  { label: "Settings", path: "/settings", icon: SettingsIcon },
];

function ProtectedRoute({ isAuthenticated, children }) {
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

function DashboardShell({ isAuthenticated, user, onLogout }) {
  const navigate = useNavigate();
  const { isDark, toggleTheme } = useTheme();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobileAccountOpen, setIsMobileAccountOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileMenuOpen]);

  const handleLogout = async () => {
    await onLogout();
    setIsMobileMenuOpen(false);
    setIsMobileAccountOpen(false);
    navigate("/login", { replace: true });
  };

  const handleMobileAccountSettings = () => {
    setIsMobileMenuOpen(false);
    setIsMobileAccountOpen(false);
    navigate("/settings");
  };

  return (
    <div className="min-h-screen overflow-x-clip bg-[#eef4f8] text-slate-950 transition-colors duration-300 dark:bg-[#07101f] dark:text-white">
      <header className="z-50 border-b border-slate-200/80 bg-white/95 px-3 py-2 shadow-sm shadow-slate-900/5 dark:border-white/10 dark:bg-[#080E1B]/95 dark:shadow-black/20">
        <div className="flex h-11 items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(true)}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm shadow-slate-900/5 transition active:scale-95 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200"
            aria-label="Open navigation menu"
            aria-expanded={isMobileMenuOpen}
          >
            <Menu size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold uppercase tracking-widest text-blue-500 dark:text-blue-300">
              FX Desk Pro
            </p>
            <p className="truncate text-sm font-bold text-slate-950 dark:text-white">
              Telegram Signal Consensus
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/settings")}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm shadow-slate-900/5 transition active:scale-95 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200"
            aria-label="Open account settings"
          >
            <UserCircle size={21} />
          </button>
        </div>
      </header>

      <div
        className={`fixed inset-0 z-[60] bg-slate-950/45 transition-opacity duration-300 ${
          isMobileMenuOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
        onClick={() => setIsMobileMenuOpen(false)}
        aria-hidden="true"
      ></div>

      <aside
        className={`fixed inset-y-0 left-0 z-[70] flex w-[min(20rem,88vw)] flex-col border-r border-slate-200 bg-white p-4 shadow-2xl shadow-slate-950/15 transition-transform duration-300 ease-out dark:border-white/10 dark:bg-[#080E1B] ${
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!isMobileMenuOpen}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-white/10">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm shadow-blue-900/15 dark:bg-blue-500 dark:shadow-blue-500/25">
              <Activity size={20} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold uppercase tracking-widest text-blue-500 dark:text-blue-300">
                FX Desk Pro
              </p>
              <p className="truncate text-base font-bold text-slate-950 dark:text-white">
                Telegram Signal Consensus
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(false)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition active:scale-95 dark:border-white/10 dark:text-slate-300"
            aria-label="Close navigation menu"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5 dark:border-white/10 dark:bg-white/[0.04] dark:shadow-black/10">
          <button
            type="button"
            onClick={() => setIsMobileAccountOpen((current) => !current)}
            className="flex w-full items-center gap-3 p-3 text-left transition hover:bg-slate-100/80 active:scale-[0.99] dark:hover:bg-white/10"
            aria-expanded={isMobileAccountOpen}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-sky-500 text-sm font-bold text-white shadow-sm shadow-blue-900/15 dark:from-blue-500 dark:to-cyan-400 dark:shadow-blue-500/25">
              {user?.email?.charAt(0).toUpperCase() || "T"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                FX Trader
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {user?.email || "trader@example.com"}
              </p>
            </div>
            <ChevronDown
              size={18}
              className={`shrink-0 text-slate-500 transition-transform duration-300 dark:text-slate-400 ${
                isMobileAccountOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          <div
            className={`grid transition-all duration-300 ease-out ${
              isMobileAccountOpen
                ? "grid-rows-[1fr] opacity-100"
                : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="overflow-hidden">
              <div className="mx-3 border-t border-slate-200 pb-3 pt-2 dark:border-white/10">
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:scale-[0.99] dark:text-slate-200 dark:hover:bg-white/10"
                >
                  <span className="inline-flex items-center gap-3">
                    {isDark ? <Sun size={17} /> : <Moon size={17} />}
                    Appearance
                  </span>
                  <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-xs text-blue-500 dark:text-blue-300">
                    {isDark ? "Dark" : "Light"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleMobileAccountSettings}
                  className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:scale-[0.99] dark:text-slate-200 dark:hover:bg-white/10"
                >
                  <UserCircle size={17} />
                  Account Settings
                </button>
                <button
                  type="button"
                  className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 active:scale-[0.99] dark:text-slate-200 dark:hover:bg-white/10"
                >
                  <Bell size={17} />
                  Notifications
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-500 transition hover:bg-red-500/10 active:scale-[0.99] dark:text-red-300"
                >
                  <LogOut size={17} />
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="my-5 h-px bg-slate-200 dark:bg-white/10"></div>

        <nav className="space-y-2">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setIsMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                    isActive
                      ? "bg-blue-600 text-white shadow-sm shadow-blue-900/15 dark:bg-blue-500 dark:shadow-blue-500/20"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10"
                  }`
                }
              >
                <Icon size={18} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-auto rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm font-semibold text-slate-500 dark:text-slate-300">
          Telegram signal workspace
        </div>
      </aside>

      <div className="min-h-screen min-w-0">
        <main className="min-w-0 p-3 sm:p-6 xl:p-8 2xl:p-10">
          <div className="mx-auto w-full min-w-0 max-w-6xl">
            <Routes>
              <Route
                path="/"
                element={
                  <Navigate
                    to={isAuthenticated ? "/dashboard" : "/login"}
                    replace
                  />
                }
              />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute isAuthenticated={isAuthenticated}>
                    <Dashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/signals"
                element={
                  <ProtectedRoute isAuthenticated={isAuthenticated}>
                    <Signals />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/analytics"
                element={
                  <ProtectedRoute isAuthenticated={isAuthenticated}>
                    <Analytics />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute isAuthenticated={isAuthenticated}>
                    <Settings />
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const isAuthenticated = Boolean(user);

  useEffect(() => {
    let isMounted = true;

    getCurrentUser()
      .then((currentUser) => {
        if (isMounted) {
          setUser(currentUser);
        }
      })
      .catch(() => {
        if (isMounted) {
          setUser(null);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsCheckingSession(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleLogin = (loggedInUser) => {
    setUser(loggedInUser);
  };

  const handleLogout = async () => {
    await logout().catch(() => {});
    setUser(null);
  };

  if (isCheckingSession) {
    return (
      <ThemeProvider>
        <div className="flex min-h-screen items-center justify-center bg-[#050B16] text-sm font-semibold text-slate-300">
          Checking session
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={
              <Login isAuthenticated={isAuthenticated} onLogin={handleLogin} />
            }
          />
          <Route
            path="/*"
            element={
              <ProtectedRoute isAuthenticated={isAuthenticated}>
                <DashboardShell
                  isAuthenticated={isAuthenticated}
                  user={user}
                  onLogout={handleLogout}
                />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
