import React, { useEffect, useState } from 'react';
import { CreditCard, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { pmsService } from '@/services/pmsService';

function isApprovedWorkspace(user) {
  const property = user?.property;
  return property?.status === 'active' && property?.package && property.package !== 'none';
}

function isSchemaCompatibilityError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return /schema cache|could not find the function|function .* does not exist|404|not found/.test(message);
}

export default function PaywallGuard({ module, children }) {
  const { user } = useAuth();
  const [state, setState] = useState({ loading: true, allowed: false, reason: '' });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;

    async function checkAccess() {
      if (!user || user.isPlatformOwner) {
        if (alive) setState({ loading: false, allowed: true, reason: 'platform_owner' });
        return;
      }

      if (!isApprovedWorkspace(user)) {
        if (alive) setState({ loading: false, allowed: false, reason: 'property_not_active' });
        return;
      }

      try {
        const access = await pmsService.getSubscriptionAccess(user.property.id, module);
        // Dashboard is a landing workspace and is permitted whenever the property is active and packaged.
        if (module === 'dashboard' && access?.reason === 'subscription_required') {
          const packageEnabled = ['standard', 'premium', 'professional'].includes(user.property.package);
          if (packageEnabled && user.property.status === 'active') {
            setState({ loading: false, allowed: true, reason: 'active_package_dashboard' });
            return;
          }
        }
        if (alive) {
          setState({
            loading: false,
            allowed: Boolean(access?.allowed),
            reason: access?.reason || 'subscription_required',
          });
        }
      } catch (error) {
        // Older deployments may not have the subscription RPC in PostgREST's
        // schema cache yet. Do not turn a working approved workspace into a
        // false paywall during migration rollout. This fallback is deliberately
        // narrow; real subscription denials returned by the RPC are respected.
        if (alive && isSchemaCompatibilityError(error)) {
          setState({ loading: false, allowed: true, reason: 'approved_package_fallback' });
        } else if (alive) {
          setState({ loading: false, allowed: false, reason: error?.message || 'subscription_check_failed' });
        }
      }
    }

    setState((current) => ({ ...current, loading: true }));
    checkAccess();
    return () => { alive = false; };
  }, [user, module, retry]);

  if (state.loading) {
    return (
      <div className="flex h-full min-h-64 items-center justify-center bg-[#F8F8F7] p-6">
        <div className="flex items-center gap-2 text-sm text-[#5F666D]">
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
          Checking workspace access…
        </div>
      </div>
    );
  }

  if (state.allowed) return children;

  return (
    <div className="flex h-full min-h-64 items-center justify-center bg-[#F8F8F7] p-6">
      <div className="max-w-md rounded-2xl border border-[#E5E5E5] bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#FFD300]">
          <CreditCard size={22} aria-hidden="true" />
        </div>
        <h2 className="text-xl font-black text-[#090C11]">Workspace access unavailable</h2>
        <p className="mt-2 text-sm text-[#757B81]">
          This workspace is not currently enabled for this property or subscription.
        </p>
        <div className="mt-4 rounded-xl bg-[#F2F2F2] p-3 text-left text-xs text-[#5F666D]">
          <div><strong>Workspace:</strong> {module || '—'}</div>
          <div className="mt-1"><strong>Reason:</strong> {state.reason || 'subscription_required'}</div>
        </div>
        <button
          type="button"
          onClick={() => setRetry((value) => value + 1)}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#FFD300] px-4 py-2 text-sm font-black text-[#090C11]"
        >
          <RefreshCw size={15} aria-hidden="true" />
          Check again
        </button>
      </div>
    </div>
  );
}
