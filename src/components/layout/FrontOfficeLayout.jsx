import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import AppShell from './AppShell';

/**
 * Room Planner is a full-screen operational wall chart. Do not mount the
 * Front Office AppShell here: it owns the top bar, sidebar, and mobile nav.
 * Matching an optional trailing slash also prevents the shell reappearing
 * when the route is normalized by a link or browser navigation.
 */
export default function FrontOfficeLayout() {
  const { pathname } = useLocation();
  const isDedicatedPlanner = /^\/frontoffice\/room-planner\/?$/.test(pathname);

  if (isDedicatedPlanner) {
    return (
      <main className="fixed inset-0 z-50 h-[100dvh] w-screen overflow-hidden bg-[var(--bg)] text-[var(--text)]">
        <Outlet />
      </main>
    );
  }

  return <AppShell workspace="frontoffice" />;
}
