import { useEffect, useState } from 'react';
import { Lock, LoaderCircle } from 'lucide-react';
import { hasFeature, PACKAGE_LABELS } from '@/lib/entitlements';
import { useAuth } from '@/lib/AuthContext';
import { featureEntitlementService } from '@/services/featureEntitlementService';

// UI gate: server-resolved overrides are loaded from the protected entitlement RPC.
// Sensitive reads/writes must additionally be checked by their database RLS/RPC boundary.
export default function FeatureGate({ feature, children, fallback }) {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const pkg = user?.property?.package || 'none';
  const [state, setState] = useState({ propertyId: null, loading: true, features: null, error: '' });

  useEffect(() => {
    let active = true;
    if (!propertyId) {
      setState({ propertyId: null, loading: false, features: {}, error: '' });
      return () => { active = false; };
    }
    setState(previous => ({ ...previous, propertyId, loading: true, error: '' }));
    featureEntitlementService.getForProperty(propertyId)
      .then(result => { if (active) setState({ propertyId, loading: false, features: result.features, error: '' }); })
      .catch(error => { if (active) setState({ propertyId, loading: false, features: null, error: error?.message || 'Entitlements unavailable' }); });
    return () => { active = false; };
  }, [propertyId]);

  if (state.loading || state.propertyId !== propertyId) {
    return <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground" role="status"><LoaderCircle className="h-4 w-4 animate-spin"/> Checking feature access…</div>;
  }

  // Fail closed when server entitlements cannot be retrieved.
  const allowed = hasFeature(pkg, feature) && state.features?.[feature] === true;
  if (allowed) return children;
  if (fallback) return fallback;

  return <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-16 text-center">
    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted"><Lock className="h-5 w-5 text-muted-foreground" aria-hidden="true"/></div>
    <h3 className="text-lg font-semibold text-foreground">{state.error ? 'Feature access could not be verified' : 'This feature is not enabled for this property'}</h3>
    <p className="mt-1 text-sm text-muted-foreground">{state.error || `Assigned package: ${PACKAGE_LABELS[pkg] || 'None'}`}</p>
    <p className="mt-1 text-sm text-muted-foreground">Contact the property owner/admin if you need access.</p>
  </div>;
}
