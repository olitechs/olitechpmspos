import React from 'react';
import PinPad from '@/components/auth/PinPad';

export default function POSAccessGate({ propertyName, logoUrl, error, busy, onSubmit }) {
  return <PinPad
    fullscreen
    pinLength={4}
    title="POS Access"
    staffName={propertyName || 'Restaurant POS'}
    brandLogo={logoUrl}
    subtitle="Enter your property's four-digit access PIN to continue to the restaurant floor and shift."
    helperText="Access is property-specific. Staff identity and permissions remain linked to your signed-in account."
    error={error}
    busy={busy}
    onSubmit={onSubmit}
  />;
}
