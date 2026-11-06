import React from 'react';
import PinPad from '@/components/auth/PinPad';

export default function POSAccessGate({ propertyName, logoUrl, error, busy, canManagePin, onAdminReset, onSubmit }) {
  return <PinPad
    fullscreen
    pinLength={4}
    title="POS Access"
    staffName={propertyName || 'Restaurant POS'}
    brandLogo={logoUrl}
    subtitle="Enter your property's four-digit access PIN to continue to the restaurant floor and shift."
    helperText="First-time PIN: 1234. If your property administrator has changed it, enter the updated code."
    error={error}
    busy={busy}
    footerAction={canManagePin ? <button type="button" onClick={onAdminReset} className="text-xs font-semibold text-[var(--primary)] underline underline-offset-4">Property administrator? Reset POS PIN</button> : null}
    onSubmit={onSubmit}
  />;
}
