import React from "react";
import { ArrowUpRight, CheckCircle2, KeyRound, ShieldCheck, Sparkles } from "lucide-react";

export default function AuthLayout({ icon: Icon = ShieldCheck, title, subtitle, footer, children }) {
  return (
    <main className="min-h-screen bg-[#EAF0F7] px-4 py-6 text-[#121418] sm:px-6 lg:px-10">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-[1320px] items-center justify-center">
        <section className="relative w-full overflow-hidden rounded-[30px] border border-white/80 bg-white shadow-[0_30px_90px_rgba(43,61,84,.16)] lg:min-h-[760px]">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -left-32 -top-32 h-72 w-72 rounded-full bg-[#FFC400]/10 blur-2xl" />
            <div className="absolute -bottom-40 left-[42%] h-96 w-96 rounded-full bg-[#DDE7F2] blur-3xl" />
          </div>

          <div className="relative grid min-h-[760px] lg:grid-cols-[44%_56%]">
            <section className="flex flex-col px-7 py-8 sm:px-12 sm:py-10 lg:px-16 lg:py-12">
              <header className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#FFC400] text-[#121418] shadow-sm">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="text-base font-black tracking-tight">OliTechs</div>
                    <div className="text-[9px] font-bold uppercase tracking-[.24em] text-[#9CA3AF]">PMS & POS</div>
                  </div>
                </div>
                <div className="hidden items-center gap-1 text-xs font-semibold text-[#9CA3AF] sm:flex">
                  <span>Secure access</span>
                  <ShieldCheck className="h-4 w-4" />
                </div>
              </header>

              <div className="flex flex-1 items-center py-10 lg:py-0">
                <div className="w-full max-w-[440px]">
                  <div className="mb-8">
                    <p className="mb-3 text-[11px] font-black uppercase tracking-[.3em] text-[#FFC400]">
                      WELCOME
                    </p>
                    <h1 className="text-4xl font-black leading-[1.04] tracking-[-.04em] text-[#121418] sm:text-5xl">
                      {title}
                    </h1>
                    {subtitle && (
                      <p className="mt-4 max-w-md text-sm leading-6 text-[#6B7280] sm:text-base">
                        {subtitle}
                      </p>
                    )}
                  </div>

                  <div className="rounded-[22px] border border-[#E5E7EB] bg-white p-1 shadow-[0_16px_40px_rgba(18,20,24,.07)]">
                    <div className="rounded-[18px] bg-[#FAFAF8] p-6 sm:p-7">
                      {children}
                    </div>
                  </div>

                  {footer && (
                    <p className="mt-6 text-center text-sm text-[#6B7280]">{footer}</p>
                  )}
                </div>
              </div>
            </section>

            <aside className="relative hidden overflow-hidden bg-[#F7F9FC] lg:block">
              <div className="absolute inset-0">
                <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white" />
                <div className="absolute -bottom-40 -left-24 h-[520px] w-[520px] rounded-full bg-[#DCE6F1]" />
                <div className="absolute right-[-90px] top-[42%] h-[420px] w-[420px] rounded-full border-[70px] border-white/80" />
              </div>

              <div className="relative flex h-full items-center justify-center p-10 xl:p-16">
                <div className="relative w-full max-w-[610px]">
                  <div className="absolute left-[8%] top-[5%] flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#FFC400] shadow-[0_12px_30px_rgba(18,20,24,.10)]">
                    <Sparkles className="h-5 w-5" />
                  </div>

                  <div className="absolute right-[7%] top-[12%] flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#6B7280] shadow-[0_12px_30px_rgba(18,20,24,.10)]">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>

                  <div className="relative mx-auto flex aspect-[1.08/1] w-[76%] items-center justify-center rounded-full bg-[#FFC400] shadow-[0_30px_70px_rgba(18,20,24,.12)]">
                    <div className="absolute inset-[8%] rounded-full border-[18px] border-white/35" />

                    <div className="relative w-[48%] rounded-[22px] border-[7px] border-[#121418] bg-white p-3 shadow-[0_25px_50px_rgba(18,20,24,.18)]">
                      <div className="flex h-9 items-center justify-center rounded-lg bg-[#121418]">
                        <div className="h-2 w-14 rounded-full bg-[#FFC400]" />
                      </div>
                      <div className="mt-4 space-y-2">
                        <div className="h-2.5 w-4/5 rounded bg-[#E5E7EB]" />
                        <div className="h-8 rounded-lg border border-[#E5E7EB] bg-[#FAFAF8]" />
                        <div className="h-8 rounded-lg border border-[#E5E7EB] bg-[#FAFAF8]" />
                        <div className="h-8 rounded-lg bg-[#FFC400]" />
                      </div>
                      <div className="mx-auto mt-4 h-1.5 w-10 rounded-full bg-[#D1D5DB]" />
                    </div>

                    <div className="absolute -bottom-[3%] right-[12%] h-[45%] w-[20%] rounded-t-[45%] bg-[#121418]" />
                    <div className="absolute bottom-[12%] right-[20%] h-[32%] w-[9%] rounded-full bg-[#FFC400] shadow-[8px_20px_0_0_#121418]" />
                  </div>

                  <div className="absolute bottom-[4%] left-[3%] rounded-2xl border border-white bg-white px-4 py-3 shadow-[0_16px_35px_rgba(18,20,24,.10)]">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#121418] text-[#FFC400]">
                        <KeyRound className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">Protected</p>
                        <p className="text-xs font-black text-[#121418]">Platform access</p>
                      </div>
                    </div>
                  </div>

                  <div className="absolute bottom-[15%] right-[1%] flex items-center gap-2 rounded-full bg-[#121418] px-4 py-2 text-[10px] font-bold text-white shadow-lg">
                    Secure workspace
                    <ArrowUpRight className="h-3.5 w-3.5 text-[#FFC400]" />
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
