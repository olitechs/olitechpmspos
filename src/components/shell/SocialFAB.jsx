import React from 'react';
import { motion } from 'framer-motion';
import { MessageCircle } from 'lucide-react';

// Only the WhatsApp link is confirmed real; guessed social profiles were
// removed during the Phase 1 audit cleanup (AUDIT.md B7).
const WHATSAPP = 'https://wa.me/254745043121';

/**
 * Floating action button, bottom-right, linking directly to OliTechs'
 * confirmed WhatsApp contact with a subtle attention pulse.
 */
export default function SocialFAB() {
  return (
    <motion.a
      href={WHATSAPP}
      target="_blank"
      rel="noreferrer"
      whileTap={{ scale: 0.9 }}
      whileHover={{ scale: 1.06 }}
      aria-label="Contact OliTechs on WhatsApp"
      className="relative fixed bottom-5 right-5 z-[60] flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-overlay)] sm:bottom-6 sm:right-6"
    >
      <motion.span
        className="absolute inset-0 rounded-full bg-primary"
        animate={{ scale: [1, 1.4, 1], opacity: [0.55, 0, 0.55] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
      />
      <span className="relative z-10 flex items-center justify-center">
        <MessageCircle className="h-6 w-6" />
      </span>
    </motion.a>
  );
}
