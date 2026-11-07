import React from 'react';

/** Official OliTechs identity; public SVG assets are generated from src/index.css tokens. */
export default function BrandLogo({ compact = false, className = '', alt = 'OliTechs' }) {
  return (
    <img
      src={compact ? '/app-icon.svg' : '/olitechs-logo.svg'}
      alt={alt}
      className={className || (compact ? 'h-9 w-9 shrink-0 object-contain' : 'h-9 w-auto max-w-[156px] object-contain')}
      loading="eager"
      decoding="async"
    />
  );
}
