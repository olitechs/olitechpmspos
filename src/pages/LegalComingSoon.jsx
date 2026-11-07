import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from '@/components/ui/BrandLogo';

export default function LegalComingSoon({ page = 'terms' }) {
  const title = page === 'privacy' ? 'Privacy' : 'Terms of Service';

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | OliTechs`;
    return () => { document.title = previousTitle; };
  }, [title]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4 py-10 text-[var(--text)]">
      <section className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm sm:p-10" aria-labelledby="legal-coming-soon-title">
        <Link to="/" aria-label="Return to OliTechs home">
          <BrandLogo className="h-10 w-auto max-w-[156px] object-contain object-left" />
        </Link>
        <p className="mt-8 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">Coming soon</p>
        <h1 id="legal-coming-soon-title" className="mt-2 text-3xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
          The OliTechs {title.toLowerCase()} page is being prepared. Please contact the OliTechs team if you need this information before it is published.
        </p>
        <a href="mailto:info@olitech.co.ke" className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--on-primary)] hover:bg-[var(--primary-hover)]">
          Contact OliTechs
        </a>
        <div className="mt-4">
          <Link to="/" className="text-sm font-medium text-[var(--primary-text)] underline underline-offset-4 hover:text-[var(--primary-hover)]">Back to OliTechs</Link>
        </div>
      </section>
    </main>
  );
}
