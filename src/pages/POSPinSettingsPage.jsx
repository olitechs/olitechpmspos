import React from 'react';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import AccessPinTab from '@/components/pos/AccessPinTab';

export default function POSPinSettingsPage() {
  const { user } = useAuth();
  const role = String(user?.propertyRole || user?.staff?.role || '').toLowerCase();
  const canManagePin = Boolean(
    user?.isPlatformOwner ||
    ['owner', 'admin'].includes(role) ||
    ['hotel_admin', 'super_admin'].includes(role)
  );

  if (!canManagePin) return <Navigate to="/pos" replace />;

  return (
    <main className="min-h-screen bg-[var(--canvas)] px-4 py-6 text-[var(--text)] sm:px-6">
      <div className="mx-auto max-w-4xl">
        <Link to="/pos" className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)] hover:underline">
          <ArrowLeft size={16} /> Back to POS
        </Link>
        <header className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]">
            <KeyRound size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold">POS access PIN</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Create the first PIN for this property or securely replace the existing one.</p>
          </div>
        </header>
        <AccessPinTab />
      </div>
    </main>
  );
}
