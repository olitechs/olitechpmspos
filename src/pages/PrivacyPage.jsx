import React from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from '@/components/ui/BrandLogo';

// Draft copy written from what the product actually does today (verified in the
// codebase). It makes no certification claims and describes no cookies,
// analytics or marketing tools, because none are wired in. The owner must have
// this reviewed by a lawyer before treating it as binding. See
// docs/OPEN_QUESTIONS.md.
export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[var(--brand-canvas)] text-[var(--text)]">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:underline"><BrandLogo className="h-7 w-auto max-w-[110px] object-contain" /></Link>
        <p className="mt-6 inline-block rounded-full border border-[var(--warning-text)] bg-[var(--warning-soft)] px-3 py-1 text-xs font-bold text-[var(--warning-text)]">Draft — pending legal review</p>
        <h1 className="mt-4 text-3xl font-black">Privacy Notice</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">This notice describes the personal data the OliTechs PMS + POS service handles and who can see it. It is a working draft and is not yet final.</p>

        <div className="mt-8 space-y-6 text-sm leading-6">
          <section>
            <h2 className="text-base font-bold">Who this applies to</h2>
            <p className="mt-2">This notice covers two groups of people: staff who sign in to the service, and guests whose details a hotel enters while using it. If you are a hotel guest, your data is held by the hotel you interacted with; this notice describes how the software stores it.</p>
          </section>

          <section>
            <h2 className="text-base font-bold">What data is stored</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li><strong>Staff accounts:</strong> name, contact details, role, assigned workspaces, PIN verification records, and sign-in and activity history.</li>
              <li><strong>Guest records:</strong> names, contact details, reservation dates, room assignments, charges and payments recorded on the guest's folio.</li>
              <li><strong>Operational records:</strong> POS orders, receipts, stock records, housekeeping and maintenance activity, and audit logs of significant actions.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-bold">Who can see it</h2>
            <p className="mt-2">Data is stored per business. A business's staff can see only that business's workspace, and only the parts their role allows. OliTechs platform administrators have technical access to workspaces for account administration and support. The service does not sell personal data or share it with advertisers.</p>
          </section>

          <section>
            <h2 className="text-base font-bold">How long it is kept</h2>
            <p className="mt-2">Business records are kept while the business's subscription is active. Retention after that, and deletion on request, is arranged with the workspace administrator and the OliTechs team.</p>
          </section>

          <section>
            <h2 className="text-base font-bold">Security</h2>
            <p className="mt-2">Accounts authenticate with a password or a workspace PIN, sessions expire, and staff access is scoped by role and property. No system is perfectly secure, so report any suspected misuse through the contact channels published on this site.</p>
          </section>

          <section>
            <h2 className="text-base font-bold">Your choices</h2>
            <p className="mt-2">Hotel guests should contact the hotel they stayed with to view, correct or delete their details, since the hotel controls its own records. Staff should contact their workspace administrator for account matters.</p>
          </section>
        </div>

        <p className="mt-10 text-xs text-[var(--text-muted)]">See also the <Link to="/terms" className="underline">terms of service</Link>.</p>
      </div>
    </div>
  );
}
