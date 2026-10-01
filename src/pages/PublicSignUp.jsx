import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { User, Mail, Lock, Loader2, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

function BrandMark() {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFC400] text-[#121418] shadow-sm" aria-hidden="true">
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
  return <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280]">{children}</span>;
}

export default function PublicSignUp() {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [terms, setTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmation, setConfirmation] = useState(false);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirm) return setError('Passwords do not match');
    if (form.password.length < 6) return setError('Password must be at least 6 characters');
    if (!terms) return setError('Please agree to the Terms & Privacy.');

    setLoading(true);
    try {
      const r = await register({
        name: form.name,
        email: form.email,
        password: form.password,
        businessName: '',
      });

      if (r?.needsEmailConfirmation) setConfirmation(true);
      localStorage.setItem('olitech_trial_started', '1');
    } catch (err) {
      setError(err.message || 'Could not create your account.');
    } finally {
      setLoading(false);
    }
  };

  if (confirmation) {
    return (
      <main className="min-h-screen bg-[#F7F6F3] px-4 py-8 sm:px-6 lg:flex lg:items-center lg:justify-center">
        <div className="w-full max-w-md rounded-[24px] border border-[#E5E7EB] bg-white p-8 text-center shadow-[0_18px_45px_rgba(18,20,24,0.12)]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#FFC400] text-[#121418]">
            <Mail className="h-5 w-5" />
          </div>
          <h1 className="mt-5 text-2xl font-extrabold text-[#121418]">Check your email</h1>
          <p className="mt-2 text-sm leading-6 text-[#6B7280]">
            We sent a confirmation link to {form.email}. Your 7-day trial application is ready and will remain pending until your property is approved.
          </p>
          <Link to="/signin" className="mt-6 inline-flex rounded-xl bg-[#121418] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#FFC400] hover:text-[#121418]">
            Go to Sign In
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F7F6F3] px-4 py-8 sm:px-6 lg:flex lg:items-center lg:justify-center lg:py-10">
      <div className="relative w-full max-w-6xl">
        <section className="relative min-h-[700px] overflow-hidden rounded-[28px] bg-[#121418] shadow-[0_24px_60px_rgba(18,20,24,0.18)] lg:min-h-[600px]">
          <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full border border-white/[0.035] bg-white/[0.012]" />
          <div className="absolute -bottom-40 left-8 h-96 w-96 rounded-full bg-[#FFC400]/[0.035]" />
          <div className="absolute right-[-180px] top-20 h-[420px] w-[420px] rounded-full border border-white/[0.04]" />

          <div className="relative flex min-h-[700px] flex-col lg:min-h-[600px] lg:flex-row">
            <div className="flex w-full flex-col justify-center px-7 pb-10 pt-10 text-white sm:px-12 lg:w-[60%] lg:px-16 lg:py-16">
              <Link to="/" className="mb-12 flex w-fit items-center gap-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#FFC400] focus:ring-offset-2 focus:ring-offset-[#121418]">
                <BrandMark />
                <span className="text-base font-extrabold tracking-tight">OliTechs</span>
              </Link>

              <div className="max-w-[500px]">
                <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-[#FFC400]">OliTechs PMS &amp; POS</p>
                <h1 className="text-4xl font-extrabold uppercase tracking-[0.08em] text-white sm:text-5xl">Welcome</h1>
                <p className="mt-4 max-w-lg text-base font-semibold text-white/85 sm:text-lg">OliTechs PMS &amp; POS</p>
                <p className="mt-4 max-w-lg text-sm leading-7 text-white/60 sm:text-[15px]">
                  Manage your hotel operations, reservations, and point of sale from one powerful dashboard.
                </p>
              </div>
            </div>

            <div className="relative z-10 flex w-full items-center px-4 pb-8 sm:px-8 lg:absolute lg:right-[4%] lg:top-1/2 lg:w-[43%] lg:-translate-y-1/2 lg:px-0 lg:pb-0">
              <div className="w-full rounded-[22px] bg-white p-6 shadow-[0_18px_45px_rgba(0,0,0,0.22)] sm:p-8 lg:p-9">
                <div className="mb-5">
                  <h2 className="text-2xl font-extrabold tracking-tight text-[#121418] sm:text-[27px]">Create your account</h2>
                  <p className="mt-1 text-[11px] leading-5 text-[#6B7280]">Set up your OliTechs PMS &amp; POS account.</p>
                </div>

                {error && (
                  <div role="alert" className="mb-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs font-medium text-red-600">
                    {error}
                  </div>
                )}

                <form onSubmit={submit} className="space-y-3.5">
                  <div>
                    <label htmlFor="signup-name" className="mb-1.5 block text-[11px] font-semibold text-[#6B7280]">Full Name</label>
                    <div className="relative">
                      <FieldIcon><User className="h-4 w-4" /></FieldIcon>
                      <input
                        id="signup-name"
                        name="name"
                        type="text"
                        required
                        autoComplete="name"
                        value={form.name}
                        onChange={(e) => update('name', e.target.value)}
                        placeholder="Enter your full name"
                        className="h-11 w-full rounded-xl border border-[#E5E7EB] bg-white pl-11 pr-4 text-sm text-[#1A1D21] outline-none transition placeholder:text-[#A1A7AF] focus:border-[#FFC400] focus:ring-2 focus:ring-[#FFC400]/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="signup-email" className="mb-1.5 block text-[11px] font-semibold text-[#6B7280]">Email</label>
                    <div className="relative">
                      <FieldIcon><Mail className="h-4 w-4" /></FieldIcon>
                      <input
                        id="signup-email"
                        name="email"
                        type="email"
                        required
                        autoComplete="email"
                        value={form.email}
                        onChange={(e) => update('email', e.target.value)}
                        placeholder="Enter your email"
                        className="h-11 w-full rounded-xl border border-[#E5E7EB] bg-white pl-11 pr-4 text-sm text-[#1A1D21] outline-none transition placeholder:text-[#A1A7AF] focus:border-[#FFC400] focus:ring-2 focus:ring-[#FFC400]/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="signup-password" className="mb-1.5 block text-[11px] font-semibold text-[#6B7280]">Password</label>
                    <div className="relative">
                      <FieldIcon><Lock className="h-4 w-4" /></FieldIcon>
                      <input
                        id="signup-password"
                        name="password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(e) => update('password', e.target.value)}
                        placeholder="Create a password"
                        className="h-11 w-full rounded-xl border border-[#E5E7EB] bg-white pl-11 pr-14 text-sm text-[#1A1D21] outline-none transition placeholder:text-[#A1A7AF] focus:border-[#FFC400] focus:ring-2 focus:ring-[#FFC400]/20"
                      />
                      <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#6B7280] hover:text-[#121418] focus:outline-none focus:ring-2 focus:ring-[#FFC400]" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="signup-confirm" className="mb-1.5 block text-[11px] font-semibold text-[#6B7280]">Confirm Password</label>
                    <div className="relative">
                      <FieldIcon><Lock className="h-4 w-4" /></FieldIcon>
                      <input
                        id="signup-confirm"
                        name="confirmPassword"
                        type={showConfirm ? 'text' : 'password'}
                        required
                        minLength={6}
                        autoComplete="new-password"
                        value={form.confirm}
                        onChange={(e) => update('confirm', e.target.value)}
                        placeholder="Confirm your password"
                        className="h-11 w-full rounded-xl border border-[#E5E7EB] bg-white pl-11 pr-14 text-sm text-[#1A1D21] outline-none transition placeholder:text-[#A1A7AF] focus:border-[#FFC400] focus:ring-2 focus:ring-[#FFC400]/20"
                      />
                      <button type="button" onClick={() => setShowConfirm((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#6B7280] hover:text-[#121418] focus:outline-none focus:ring-2 focus:ring-[#FFC400]" aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}>
                        {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <label htmlFor="signup-terms" className="flex cursor-pointer items-start gap-2 pt-1 text-[10px] leading-4 text-[#6B7280]">
                    <input id="signup-terms" type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 h-3 w-3 rounded border-[#D1D5DB] accent-[#FFC400]" />
                    <span>I agree to the Terms &amp; Privacy.</span>
                  </label>

                  <button
                    type="submit"
                    disabled={loading}
                    className="flex h-11 w-full items-center justify-center rounded-xl bg-[#121418] text-sm font-bold text-white shadow-sm transition hover:bg-[#FFC400] hover:text-[#121418] disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[#FFC400] focus:ring-offset-2"
                  >
                    {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account...</> : 'Sign up'}
                  </button>

                  <p className="pt-1 text-center text-[10px] text-[#6B7280]">
                    Already have an account?{' '}
                    <Link to="/signin" className="font-bold text-[#121418] underline decoration-[#FFC400] decoration-2 underline-offset-2 hover:text-[#8A6A00]">Sign in</Link>
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
