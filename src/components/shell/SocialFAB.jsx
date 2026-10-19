import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, X as CloseIcon } from 'lucide-react';

// TODO: swap these for OliTechs' real profile URLs — only WhatsApp below is confirmed real.
const SOCIALS = [
  { key: 'whatsapp', label: 'WhatsApp', href: 'https://wa.me/254745043121', color: '#25D366', kind: 'icon' },
  { key: 'instagram', label: 'Instagram', href: 'https://instagram.com/olitechs', color: '#E1306C', kind: 'mono', mono: 'IG' },
  { key: 'tiktok', label: 'TikTok', href: 'https://tiktok.com/@olitechs', color: '#25F4EE', kind: 'mono', mono: 'TT' },
  { key: 'linkedin', label: 'LinkedIn', href: 'https://linkedin.com/company/olitechs', color: '#0A66C2', kind: 'mono', mono: 'in' },
  { key: 'facebook', label: 'Facebook', href: 'https://facebook.com/olitechs', color: '#1877F2', kind: 'mono', mono: 'f' },
  { key: 'x', label: 'X', href: 'https://x.com/olitechs', color: 'var(--border)', kind: 'mono', mono: 'X' },
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
              className="group relative flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-surface text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-colors"
              aria-label={s.label}
              style={{ '--brand': s.color }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = s.color)}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = '')}
            >
              {s.kind === 'icon' ? (
                <MessageCircle className="h-5 w-5" style={{ color: s.color }} />
              ) : (
                <span className="text-[13px] font-black" style={{ color: s.color }}>
                  {s.mono}
                </span>
              )}
              <span className="pointer-events-none absolute right-full mr-3 whitespace-nowrap rounded-md bg-surface px-2.5 py-1 text-xs font-bold text-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
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
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary text-foreground shadow-[0_10px_30px_rgba(255,211,0,0.35)]"
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
