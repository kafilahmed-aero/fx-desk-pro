import { useEffect, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  ChevronRight,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Moon,
  Search,
  Settings as SettingsIcon,
  Signal,
  Sun,
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
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { getCurrentUser, logout } from "./services/authService";

const navigationItems = [
  { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { label: "Signals", path: "/signals", icon: Signal },
  { label: "Analytics", path: "/analytics", icon: BarChart3 },
  { label: "Settings", path: "/settings", icon: SettingsIcon },
];

const initialMarketPrices = [
  { pair: "GOLD", price: 2368.4, spread: "1.8", precision: 2, direction: "up" },
  { pair: "EURUSD", price: 1.0842, spread: "0.6", precision: 4, direction: "down" },
  { pair: "GBPUSD", price: 1.269, spread: "0.8", precision: 4, direction: "up" },
  { pair: "USDJPY", price: 156.84, spread: "0.7", precision: 3, direction: "down" },
  { pair: "AUDUSD", price: 0.6648, spread: "0.9", precision: 4, direction: "up" },
  { pair: "USDCHF", price: 0.9126, spread: "0.8", precision: 4, direction: "down" },
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
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [marketPrices, setMarketPrices] = useState(initialMarketPrices);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setMarketPrices((prices) => {
        const priceIndex = Math.floor(Math.random() * prices.length);

        return prices.map((market, index) => {
          if (index !== priceIndex) {
            return market;
          }

          const direction = Math.random() > 0.48 ? "up" : "down";
          const volatility = market.pair === "GOLD" ? 1.2 : 0.0012;
          const change = Math.random() * volatility;
          const price =
            direction === "up"
              ? market.price + change
              : market.price - change;

          return { ...market, price, direction };
        });
      });
    }, 1800);

    return () => window.clearInterval(intervalId);
  }, []);

  const handleLogout = () => {
    onLogout();
    setIsProfileOpen(false);
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_34%),linear-gradient(135deg,#f8fafc,#e2e8f0)] text-slate-950 transition-colors duration-300 dark:bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_32%),linear-gradient(135deg,#07101f,#0B1120_45%,#111827)] dark:text-white">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="sticky top-0 z-40 border-b border-white/50 bg-white/75 px-4 py-4 shadow-xl shadow-slate-200/70 backdrop-blur-2xl transition-colors duration-300 dark:border-white/10 dark:bg-[#080E1B]/80 dark:shadow-black/20 lg:h-screen lg:w-72 lg:border-b-0 lg:border-r lg:px-6 lg:py-8">
          <div className="flex items-center justify-between gap-4 lg:block">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500 text-white shadow-lg shadow-blue-500/25">
                <Activity size={22} />
              </div>
              <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-blue-500 dark:text-blue-300">
                FX Desk Pro
              </p>
              <h1 className="mt-1 text-xl font-bold text-slate-950 dark:text-white lg:text-2xl">
                Forex Consensus
              </h1>
              </div>
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-bold uppercase tracking-wide text-emerald-500 shadow-lg shadow-emerald-500/10 dark:text-emerald-300 sm:flex lg:mt-8 lg:inline-flex">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400"></span>
              Live
            </div>
          </div>

          <nav className="scrollbar-fintech mt-5 flex gap-2 overflow-x-auto pb-1 lg:mt-10 lg:flex-col lg:overflow-visible lg:pb-0">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `group inline-flex items-center gap-3 whitespace-nowrap rounded-xl px-4 py-3 text-left text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5 lg:hover:translate-x-1 lg:hover:translate-y-0 ${
                    isActive
                      ? "bg-gradient-to-r from-blue-500 to-cyan-400 text-white shadow-lg shadow-blue-500/25"
                      : "text-slate-600 hover:bg-white/70 hover:text-slate-950 hover:shadow-lg hover:shadow-blue-500/10 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                  }`
                }
              >
                <Icon size={18} />
                <span>{item.label}</span>
                <ChevronRight className="ml-auto hidden opacity-0 transition group-hover:opacity-100 lg:block" size={15} />
              </NavLink>
              );
            })}
          </nav>

          <div className="mt-5 hidden rounded-2xl border border-slate-200 bg-white/55 p-4 shadow-lg shadow-slate-200/50 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.04] dark:shadow-black/10 lg:mt-10 lg:block">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">
              Session
            </p>
            <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-emerald-500 dark:text-emerald-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400"></span>
              Secure workspace active
            </div>
          </div>
        </aside>

        <main className="flex-1 p-4 sm:p-6 xl:p-8 2xl:p-10">
          <div className="mx-auto max-w-7xl">
            <div className="mb-4 overflow-hidden rounded-2xl border border-white/60 bg-white/70 shadow-xl shadow-slate-200/50 backdrop-blur-2xl dark:border-white/10 dark:bg-[#0B1120]/70 dark:shadow-black/10">
              <div className="flex items-center gap-4 border-b border-slate-200 px-4 py-2 dark:border-white/10">
                <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-blue-500 dark:text-blue-300">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400"></span>
                  Live Market Tape
                </div>
                <div className="hidden text-xs text-slate-500 dark:text-slate-400 sm:block">
                  Synthetic realtime feed
                </div>
              </div>
              <div className="scrollbar-fintech overflow-x-auto lg:overflow-hidden">
                <div className="flex min-w-max gap-3 px-4 py-3 lg:animate-ticker-scroll lg:[&:hover]:[animation-play-state:paused]">
                  {[...marketPrices, ...marketPrices].map((market, index) => (
                    <div
                      key={`${market.pair}-${index}`}
                      className={`inline-flex items-center gap-3 rounded-xl border px-4 py-2 text-sm font-semibold transition-all duration-300 ${
                        market.direction === "up"
                          ? "animate-price-flash-green border-green-400/20 bg-green-400/10 text-green-500 dark:text-green-300"
                          : "animate-price-flash-red border-red-400/20 bg-red-400/10 text-red-500 dark:text-red-300"
                      }`}
                    >
                      <span className="text-slate-700 dark:text-white">
                        {market.pair}
                      </span>
                      <span>{market.price.toFixed(market.precision)}</span>
                      <span className="inline-flex items-center gap-1 text-xs">
                        {market.direction === "up" ? (
                          <ArrowUpRight size={14} />
                        ) : (
                          <ArrowDownRight size={14} />
                        )}
                        {market.spread}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <header className="sticky top-3 z-30 mb-6 flex flex-col gap-4 rounded-2xl border border-white/60 bg-white/75 p-4 shadow-xl shadow-slate-200/60 backdrop-blur-2xl dark:border-white/10 dark:bg-[#0B1120]/70 dark:shadow-black/10 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-blue-500 dark:text-blue-300">
                  Market Command Center
                </p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Live consensus, confidence scoring, and trade signal workflow.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400 md:flex">
                  <Search size={16} />
                  Search markets
                </div>
                <button className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white/70 text-slate-600 transition hover:-translate-y-0.5 hover:text-blue-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                  <Bell size={18} />
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsProfileOpen((current) => !current)}
                    className="inline-flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/75 px-2 py-2 pr-3 text-left shadow-lg shadow-slate-200/50 transition hover:-translate-y-0.5 hover:border-blue-400/30 hover:shadow-blue-500/10 dark:border-white/10 dark:bg-white/[0.06] dark:shadow-black/10"
                    aria-expanded={isProfileOpen}
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 text-sm font-bold text-white shadow-lg shadow-blue-500/25">
                      {user?.email?.charAt(0).toUpperCase() || "U"}
                    </div>
                    <div className="hidden min-w-0 sm:block">
                      <p className="max-w-32 truncate text-sm font-bold text-slate-800 dark:text-white">
                        FX Trader
                      </p>
                      <p className="max-w-32 truncate text-xs text-slate-500 dark:text-slate-400">
                        {user?.email}
                      </p>
                    </div>
                    <ChevronDown
                      size={16}
                      className={`text-slate-500 transition ${
                        isProfileOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  <div
                    className={`absolute right-0 mt-3 w-80 origin-top-right rounded-3xl border border-white/70 bg-white/90 p-3 shadow-2xl shadow-slate-300/60 backdrop-blur-2xl transition-all duration-200 dark:border-white/10 dark:bg-[#0B1120]/95 dark:shadow-black/40 ${
                      isProfileOpen
                        ? "translate-y-0 scale-100 opacity-100"
                        : "pointer-events-none -translate-y-2 scale-95 opacity-0"
                    }`}
                  >
                    <div className="rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 p-4 text-white shadow-lg shadow-blue-500/25">
                      <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-lg font-bold">
                          {user?.email?.charAt(0).toUpperCase() || "U"}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold">FX Trader</p>
                          <p className="truncate text-sm text-white/80">
                            {user?.email}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 space-y-1">
                      <button
                        type="button"
                        onClick={toggleTheme}
                        className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10"
                      >
                        <span className="inline-flex items-center gap-3">
                          {isDark ? <Sun size={17} /> : <Moon size={17} />}
                          Appearance
                        </span>
                        <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs text-blue-500 dark:text-blue-300">
                          {isDark ? "Dark" : "Light"}
                        </span>
                      </button>
                      <NavLink
                        to="/settings"
                        onClick={() => setIsProfileOpen(false)}
                        className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10"
                      >
                        <UserCircle size={17} />
                        Account settings
                      </NavLink>
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10"
                      >
                        <Bell size={17} />
                        Notifications
                      </button>
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold text-red-500 transition hover:bg-red-500/10 dark:text-red-300"
                      >
                        <LogOut size={17} />
                        Logout
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </header>
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
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(() => getCurrentUser());
  const isAuthenticated = Boolean(user);

  const handleLogin = (loggedInUser) => {
    setUser(loggedInUser);
  };

  const handleLogout = () => {
    logout();
    setUser(null);
  };

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
              <DashboardShell
                isAuthenticated={isAuthenticated}
                user={user}
                onLogout={handleLogout}
              />
            }
          />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
