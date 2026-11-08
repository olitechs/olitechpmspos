import React from 'react';
import AppShell from './AppShell';

/**
 * All Front Office routes share the same OliTechs application shell.
 * The Room Planner owns its internal grid scrollport; it must not bypass
 * the PMS navigation or create a second application sidebar.
 */
export default function FrontOfficeLayout() {
  return <AppShell workspace="frontoffice" />;
}
