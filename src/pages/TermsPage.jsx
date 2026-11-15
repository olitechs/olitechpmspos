import React from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from '@/components/ui/BrandLogo';

// Draft copy written from what the product actually does today. It makes no
// certification, jurisdiction or data-residency claims. The owner must have
// this reviewed by a lawyer before treating it as binding. See
// docs/OPEN_QUESTIONS.md.
export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[var(--brand-canvas)] text-[var(--text)]">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:underline"><BrandLogo className="h-7 w-auto max-w-[110px] object-contain" /></Link>
        <p className="mt-6 inline-block rounded-full border border-[var(--warning-text)] bg-[var(--warning-soft)] px-3 py-1 text-xs font-bold text-[var(--warning-text)]">Draft — pending legal review</p>
        <h1 className="mt-4 text-3xl font-black">Terms of Service</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">These terms describe how the OliTechs PMS + POS service is provided. They are a working draft and are not yet final.</p>

        <div className="mt-8 space-y-6 text-sm leading-6">
          <section>
            <h2 className="text-base font-bold">What the service is</h2>
            <p className="mt-2">OliTechs PMS + POS is software for hotels and similar hospitality businesses. It covers reservations, front-office operations, point of sale, stores and inventory, reporting, and related administration. Each business using the service is a separate workspace, and the data in one workspace is not visible to another business's staff.</p>
          </section>

          <section>
            <h2 className="text-base font-bold">Accounts and access</h2>
            <p className="mt-2">A workspace administrator creates staff accounts and decides what each person can access. Staff may additionally sign in to workspaces with a PIN assigned by that administrator. Administrators are responsible for the accounts they create, for removing access when someone leaves, and for the accuracy of the business data entered into the service.</p>
          </section>

          <section>
            <h2 className="text-base font-bold">Subscriptions</h2>
            <p className="mt-2">Workspaces run on a subscription with different feature packages. If a subscription lapses or a package is downgraded, parts of the service stop working until it is renewed or upgraded. Prices and plan details are as published on this site or as agreed with the OliTechs team.</p>
          </section>

          <section>
            <h2 className="text-base font-bold">Acceptable use</h2>
            <p className="mt-2">Use the service for operating your own business. Do not use it to store data you have no right to store, to attempt to access other businesses' workspaces, or to interfere with the service's operation.</p>
          </section>

          <section>
            <h2 className="text-base font-bold">Availability and support</h2>
            <p className="mt-2">The service requires an internet connection and a configured Supabase backend. Some features — such as receipt printing — also depend on your local devices and network. Support is provided through the contact channels published on this site.</p>
          </section>

          <section>
            <h2 className="text-base font-bold">Your data</h2>
            <p className="mt-2">Your business data belongs to your business. You can export and correct it through the service's screens. How we handle personal data is described in the <Link to="/privacy" className="font-semibold text-[var(--brand-blue)] underline">privacy notice</Link>.</p>
          </section>

          <section>
            <h2 className="text-base font-bold">Changes to these terms</h2>
            <p className="mt-2">These terms will be finalised and may be updated as the product develops. Material changes will be communicated to workspace administrators before they take effect.</p>
          </section>
        </div>

        <p className="mt-10 text-xs text-[var(--text-muted)]">Questions about these terms can be sent through the contact details in the <Link to="/" className="underline">site footer</Link>.</p>
      </div>
    </div>
  );
}
