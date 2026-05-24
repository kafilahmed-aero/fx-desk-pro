import { useState } from "react";
import {
  Activity,
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Moon,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useTheme } from "../context/useTheme";
import { login } from "../services/authService";

function Login({ isAuthenticated, onLogin }) {
  const { isDark, toggleTheme } = useTheme();
  const [email, setEmail] = useState("trader@example.com");
  const [password, setPassword] = useState("password");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const redirectTo = location.state?.from?.pathname || "/dashboard";

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const user = await login({ email, password, remember });
      onLogin(user);
      navigate(redirectTo, { replace: true });
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen overflow-hidden bg-[#050B16] text-white">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden border-r border-white/10 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.24),transparent_30%),linear-gradient(145deg,#07101f,#0B1120_52%,#020617)] p-10 lg:flex lg:flex-col">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500 text-white shadow-lg shadow-blue-500/25">
              <Activity size={22} />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-blue-300">
                FX Desk Pro
              </p>
              <p className="text-lg font-bold">Forex Consensus</p>
            </div>
          </div>

          <div className="flex flex-1 flex-col justify-center">
            <p className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"></span>
              Secure trader workspace
            </p>
            <h1 className="max-w-xl text-5xl font-bold leading-tight text-white xl:text-6xl">
              Institutional-grade market access, ready when you sign in.
            </h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-slate-400">
              Monitor forex momentum, consensus signals, and risk dashboards
              from one protected command center.
            </p>

            <div className="mt-10 grid max-w-xl grid-cols-3 gap-3">
              {[
                ["24/5", "Market coverage"],
                ["128-bit", "Session guard"],
                ["Live", "Signal engine"],
              ].map(([value, label]) => (
                <div
                  key={label}
                  className="rounded-lg border border-white/10 bg-white/[0.04] p-4 shadow-xl shadow-black/10"
                >
                  <p className="text-2xl font-bold text-white">{value}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_right,rgba(14,165,201,0.18),transparent_32%),linear-gradient(145deg,#07101f,#0B1120_56%,#050B16)] px-4 py-8 sm:px-6 lg:px-10">
          <div className="w-full max-w-md animate-dashboard-in">
            <div className="mb-8 flex items-center justify-between gap-4 lg:hidden">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-500 text-white shadow-lg shadow-blue-500/25">
                  <Activity size={20} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold uppercase tracking-widest text-blue-300">
                    FX Desk Pro
                  </p>
                  <p className="truncate text-base font-bold">
                    Forex Consensus
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-slate-300 transition hover:bg-white/10 hover:text-white"
                aria-label="Toggle theme"
              >
                {isDark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.07] p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-7">
              <div className="mb-7 flex items-start justify-between gap-4">
                <div>
                  <div className="mb-4 hidden h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-lg shadow-blue-500/25 lg:flex">
                    <ShieldCheck size={24} />
                  </div>
                  <p className="text-sm font-semibold uppercase tracking-widest text-blue-300">
                    Trader login
                  </p>
                  <h2 className="mt-2 text-3xl font-bold tracking-tight text-white">
                    Welcome back
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={toggleTheme}
                  className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-slate-300 transition hover:bg-white/10 hover:text-white lg:inline-flex"
                  aria-label="Toggle theme"
                >
                  {isDark ? <Sun size={18} /> : <Moon size={18} />}
                </button>
              </div>

              <form className="space-y-5" onSubmit={handleSubmit}>
                <div>
                  <label
                    className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-slate-300"
                    htmlFor="email"
                  >
                    <Mail size={15} />
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="h-12 w-full rounded-lg border border-white/10 bg-[#080E1B] px-4 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"
                    placeholder="trader@example.com"
                    autoComplete="email"
                  />
                </div>

                <div>
                  <label
                    className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-slate-300"
                    htmlFor="password"
                  >
                    <Lock size={15} />
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="h-12 w-full rounded-lg border border-white/10 bg-[#080E1B] px-4 pr-12 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"
                      placeholder="Enter password"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <label className="inline-flex min-w-0 items-center gap-3 text-sm font-semibold text-slate-300">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(event) => setRemember(event.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-[#080E1B] text-blue-500 focus:ring-blue-400/30"
                    />
                    Remember this device
                  </label>
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Demo auth
                  </span>
                </div>

                {error ? (
                  <p className="rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm font-medium text-red-300">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-400 px-4 text-sm font-bold text-white shadow-lg shadow-blue-500/25 transition hover:-translate-y-0.5 hover:shadow-blue-500/40 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isLoading ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></span>
                      Signing in
                    </>
                  ) : (
                    <>
                      Sign in to dashboard
                      <ArrowRight size={17} />
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default Login;
