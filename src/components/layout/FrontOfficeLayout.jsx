import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import AppShell from './AppShell';

/**
 * The room planner is an operational wall-chart, not a dashboard card.
 * Give it the whole viewport so the timeline can use the available width and height.
 */
export default function FrontOfficeLayout() {
  const { pathname } = useLocation();

  if (pathname === '/frontoffice/room-planner') {
    return (
      <main className="fixed inset-0 z-50 h-[100dvh] w-screen overflow-hidden bg-[var(--bg)] text-[var(--text)]">
        <Outlet />
      </main>
    );
  }

  return <AppShell workspace="frontoffice" />;
}
