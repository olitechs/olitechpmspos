import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Lock, Loader2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

function BrandMark() {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--text)] shadow-sm" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 21h16" />
        <path d="M6 21V9l6-4 6 4v12" />
        <path d="M9 21v-5h6v5" />
        <path d="M9 11h1M14 11h1M9 14h1M14 14h1" />
      </svg>
    </span>
  );
}

function FieldIcon({ children }) {
  return <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">{children}</span>;
}

export default function PublicSignIn() {
  const { login } = useAuth();
  const [email, setEmail] = useState('demo@olitech.com');
  const [password, setPassword] = useState('demo123');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      if (remember) localStorage.setItem('olitech_remember', '1');
    } catch (err) {
      setError(err.message || 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--canvas)] px-4 py-8 sm:px-6 lg:flex lg:items-center lg:justify-center lg:py-10">
      <div className="relative w-full max-w-6xl">
        <section className="relative min-h-[620px] overflow-hidden rounded-[28px] bg-[var(--surface)] shadow-none lg:min-h-[560px]">
          <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full border border-white/[0.035] bg-[var(--surface)]/[0.012]" />
          <div className="absolute -bottom-40 left-8 h-96 w-96 rounded-full bg-[var(--primary-soft)]/[0.035]" />
          <div className="absolute right-[-180px] top-20 h-[420px] w-[420px] rounded-full border border-white/[0.04]" />

          <div className="relative flex min-h-[620px] flex-col lg:min-h-[560px] lg:flex-row">
            <div className="flex w-full flex-col justify-center px-7 pb-10 pt-10 text-[var(--text)] sm:px-12 lg:w-[60%] lg:px-16 lg:py-16">
              <Link to="/" className="mb-12 flex w-fit items-center gap-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 focus:ring-offset-[var(--surface)]">
                <BrandMark />
                <span className="text-base font-medium tracking-tight">OliTechs</span>
              </Link>

              <div className="max-w-[500px]">
                <p className="mb-4 text-xs font-medium  text-[var(--primary)]">OliTechs PMS &amp; POS</p>
                <h1 className="text-4xl font-medium  text-[var(--text)] sm:text-5xl">Welcome</h1>
                <p className="mt-4 max-w-lg text-base font-medium text-[var(--text)]/85 sm:text-lg">OliTechs PMS &amp; POS</p>
                <p className="mt-4 max-w-lg text-sm leading-7 text-[var(--text)]/60 sm:text-[15px]">
                  Manage your hotel operations, reservations, and point of sale from one powerful dashboard.
                </p>
              </div>
            </div>

            <div className="relative z-10 flex w-full items-center px-4 pb-8 sm:px-8 lg:absolute lg:right-[4%] lg:top-1/2 lg:w-[43%] lg:-translate-y-1/2 lg:px-0 lg:pb-0">
              <div className="w-full rounded-[22px] bg-[var(--surface)] p-6 shadow-[var(--shadow-overlay)] sm:p-8 lg:p-9">
                <div className="mb-6">
                  <h2 className="text-2xl font-medium tracking-tight text-[var(--text)] sm:text-[27px]">Sign in</h2>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">Access your hotel operations dashboard securely.</p>
                </div>

                {error && (
                  <div role="alert" className="mb-4 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2.5 text-xs font-medium text-[var(--danger-text)]">
                    {error}
                  </div>
                )}

                <form onSubmit={submit} className="space-y-4">
                  <div>
                    <label htmlFor="signin-email" className="mb-1.5 block text-[11px] font-medium text-[var(--text-muted)]">User Name / Email</label>
                    <div className="relative">
                      <FieldIcon><Mail className="h-4 w-4" /></FieldIcon>
                      <input
                        id="signin-email"
                        name="email"
                        type="email"
                        required
                        autoComplete="username"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter your email"
                        className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] pl-11 pr-4 text-sm text-[#1A1D21] outline-none transition placeholder:text-[#A1A7AF] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="signin-password" className="mb-1.5 block text-[11px] font-medium text-[var(--text-muted)]">Password</label>
                    <div className="relative">
                      <FieldIcon><Lock className="h-4 w-4" /></FieldIcon>
                      <input
                        id="signin-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] pl-11 pr-14 text-sm text-[#1A1D21] outline-none transition placeholder:text-[#A1A7AF] focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((value) => !value)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-1 text-[var(--text-muted)] transition hover:text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-0.5 text-[10px] text-[var(--text-muted)]">
                    <label htmlFor="remember-me" className="flex cursor-pointer items-center gap-2">
                      <input id="remember-me" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-3 w-3 rounded border-[var(--border)] accent-[var(--primary)]" />
                      Remember me
                    </label>
                    <Link to="/forgot-password" className="font-medium text-[var(--text-muted)] hover:text-[var(--text)] hover:underline">Forgot Password?</Link>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="flex h-11 w-full items-center justify-center rounded-xl bg-[var(--primary)] text-sm font-medium text-primary-foreground shadow-none transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  >
                    {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing in...</> : 'Sign in'}
                  </button>

                  <p className="pt-1 text-center text-[10px] text-[var(--text-muted)]">
                    Don&apos;t have an account?{' '}
                    <Link to="/signup" className="font-medium text-[var(--text)] underline decoration-[var(--primary)] decoration-2 underline-offset-2 hover:text-[var(--primary-hover)]">Sign Up</Link>
                  </p>
                </form>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
