import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, X as CloseIcon } from 'lucide-react';

// Only WhatsApp is a confirmed OliTechs channel. Other profiles were removed
// until the owner supplies real URLs (docs/OPEN_QUESTIONS.md).
const SOCIALS = [
  { key: 'whatsapp', label: 'WhatsApp', href: 'https://wa.me/254745043121', kind: 'icon' },
];

/**
 * Floating action button, bottom-right, that reveals social links
 * one-by-one with a staggered spring animation on click.
 */
export default function SocialFAB() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-5 right-5 z-[60] flex flex-col items-center gap-3 sm:bottom-6 sm:right-6">
      <AnimatePresence>
        {open &&
          SOCIALS.map((s, i) => (
            <motion.a
              key={s.key}
              href={s.href}
              target="_blank"
              rel="noreferrer"
              initial={{ opacity: 0, y: 18, scale: 0.4 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.4 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22, delay: i * 0.05 }}
              whileHover={{ scale: 1.12, y: -2 }}
              whileTap={{ scale: 0.94 }}
              className="group relative flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] bg-surface text-foreground shadow-[var(--shadow-overlay)] transition-colors"
              aria-label={s.label}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--primary)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = '')}
            >
              {s.kind === 'icon' ? (
                <MessageCircle className="h-5 w-5 text-primary" />
              ) : (
                <span className="text-[13px] font-black text-primary">
                  {s.mono}
                </span>
              )}              <span className="pointer-events-none absolute right-full mr-3 whitespace-nowrap rounded-md bg-surface px-2.5 py-1 text-xs font-bold text-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                {s.label}
              </span>
            </motion.a>
          ))}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        whileTap={{ scale: 0.9 }}
        aria-expanded={open}
        aria-label={open ? 'Close social links' : 'Open social links'}
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-overlay)]"
      >
        {!open && (
          <motion.span
            className="absolute inset-0 rounded-full bg-primary"
            animate={{ scale: [1, 1.4, 1], opacity: [0.55, 0, 0.55] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="relative z-10 flex items-center justify-center"
        >
          {open ? <CloseIcon className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        </motion.span>
      </motion.button>
    </div>
  );
}
