import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Loader2, Send, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { SUBSCRIPTION_SUPPORT_EMAILS } from '@/lib/subscriptionAccess';
import { pmsService } from '@/services/pmsService';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const PLAN_OPTIONS = [
  { value: 'starter', label: 'Starter' },
  { value: 'standard', label: 'Standard' },
  { value: 'professional', label: 'Professional' },
  { value: 'enterprise', label: 'Enterprise' },
];

const REQUEST_LABELS = {
  subscribe: 'subscription request',
  upgrade: 'upgrade request',
  renewal: 'renewal request',
};

const requestSchema = z.object({
  packageName: z.string().min(1, 'Choose the package you want.'),
  billingCycle: z.enum(['monthly', 'annual'], { required_error: 'Choose a billing cycle.' }),
  phone: z.string().trim().max(60, 'Phone number is too long.').optional().or(z.literal('')),
  notes: z.string().trim().max(2000, 'Please keep the message under 2000 characters.').optional().or(z.literal('')),
});

function normalisePlan(value) {
  const name = String(value || '').toLowerCase();
  return PLAN_OPTIONS.find((plan) => name.includes(plan.value))?.value || 'professional';
}

function normaliseCycle(value) {
  return String(value || '').toLowerCase() === 'annual' ? 'annual' : 'monthly';
}

const fieldClass = 'w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-[var(--primary)]';
const labelClass = 'mb-1.5 block text-xs font-bold text-foreground';
const errorClass = 'mt-1 text-xs text-[var(--danger-text)]';

/**
 * Shared subscribe/upgrade/renew request form.
 *
 * Identity and property details are read-only and displayed from the signed-in
 * session. The Edge Function re-derives them from Supabase, so the client only
 * submits the commercial choices: package, cycle, phone and notes.
 */
export default function SubscriptionRequestModal({
  open,
  onOpenChange,
  requestKind = 'subscribe',
  packageName = '',
  billingCycle = 'monthly',
}) {
  const { user } = useAuth();
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState(null);
  const kind = REQUEST_LABELS[requestKind] ? requestKind : 'subscribe';

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(requestSchema),
    defaultValues: {
      packageName: normalisePlan(packageName),
      billingCycle: normaliseCycle(billingCycle),
      phone: '',
      notes: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    setSubmitError('');
    setResult(null);
    reset({
      packageName: normalisePlan(packageName),
      billingCycle: normaliseCycle(billingCycle),
      phone: '',
      notes: '',
    });
  }, [open, packageName, billingCycle, reset]);

  const propertyName = user?.property?.business_name || user?.property?.name || '—';
  const requesterName = user?.name || user?.user_metadata?.full_name || '—';
  const requesterEmail = user?.email || '—';
  const role = String(user?.propertyRole || '').toLowerCase();
  const canRequest = Boolean(user?.property?.id) && ['owner', 'admin'].includes(role);

  const onSubmit = async (values) => {
    if (!canRequest || isSubmitting) return;
    setSubmitError('');
    try {
      const response = await pmsService.requestSubscriptionRenewal({
        propertyId: user.property.id,
        requestKind: kind,
        packageName: values.packageName,
        billingCycle: values.billingCycle,
        phone: values.phone || '',
        notes: values.notes || '',
      });
      setResult(response);
    } catch (error) {
      setSubmitError(error?.message || 'Could not send the request. Please try again.');
    }
  };

  const heading = kind === 'upgrade' ? 'Request a package upgrade' : kind === 'renewal' ? 'Renew your subscription' : 'Subscribe to OliTechs';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>
            Send your request to the OliTechs platform team. Access changes are applied only after review.
          </DialogDescription>
        </DialogHeader>

        {!canRequest ? (
          <DialogBody>
            <p className="rounded-xl border border-[var(--warning)] bg-[var(--warning-soft)] p-4 text-sm text-[var(--warning-text)]">
              Only the property owner or administrator can send a {REQUEST_LABELS[kind]}. Ask your administrator to submit it.
            </p>
          </DialogBody>
        ) : result ? (
          <DialogBody>
            <div className="rounded-2xl border border-[var(--success)] bg-[var(--success-soft)] p-4">
              <p className="flex items-center gap-2 font-bold text-[var(--success-text)]">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                {result?.already_requested ? 'A request is already with OliTechs' : 'Request sent'}
              </p>
              <p className="mt-2 text-sm text-foreground">
                {result?.already_requested
                  ? 'The platform team already has a pending request for this property.'
                  : `Your ${REQUEST_LABELS[kind]} is in the platform admin inbox and has been emailed to ${SUBSCRIPTION_SUPPORT_EMAILS.join(' and ')}.`}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">No access changes are made until OliTechs confirms the subscription.</p>
            </div>
          </DialogBody>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogBody className="space-y-4">
              <div className="rounded-xl border border-border bg-canvas p-3">
                <p className="flex items-center gap-2 text-xs font-bold text-foreground">
                  <ShieldCheck className="h-4 w-4 text-[var(--primary-hover)]" aria-hidden="true" />
                  Submitted from the signed-in property
                </p>
                <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">Property</dt><dd className="font-semibold text-foreground">{propertyName}</dd></div>
                  <div><dt className="text-muted-foreground">Requested by</dt><dd className="font-semibold text-foreground">{requesterName}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-muted-foreground">Email</dt><dd className="font-semibold text-foreground">{requesterEmail}</dd></div>
                </dl>
              </div>

              <div>
                <label className={labelClass} htmlFor="subscription-package">Package</label>
                <select id="subscription-package" className={fieldClass} {...register('packageName')}>
                  {PLAN_OPTIONS.map((plan) => <option key={plan.value} value={plan.value}>{plan.label}</option>)}
                </select>
                {errors.packageName && <p className={errorClass} role="alert">{errors.packageName.message}</p>}
              </div>

              <div>
                <label className={labelClass} htmlFor="subscription-cycle">Billing cycle</label>
                <select id="subscription-cycle" className={fieldClass} {...register('billingCycle')}>
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual — save 20%</option>
                </select>
                {errors.billingCycle && <p className={errorClass} role="alert">{errors.billingCycle.message}</p>}
              </div>

              <div>
                <label className={labelClass} htmlFor="subscription-phone">Phone number <span className="font-normal text-muted-foreground">(optional)</span></label>
                <input id="subscription-phone" type="tel" autoComplete="tel" className={fieldClass} placeholder="e.g. +254 700 000 000" {...register('phone')} />
                {errors.phone && <p className={errorClass} role="alert">{errors.phone.message}</p>}
              </div>

              <div>
                <label className={labelClass} htmlFor="subscription-notes">Message <span className="font-normal text-muted-foreground">(optional)</span></label>
                <textarea id="subscription-notes" rows={4} className={fieldClass} placeholder="Tell us about your property, expected rooms or staff, and any questions." {...register('notes')} />
                {errors.notes && <p className={errorClass} role="alert">{errors.notes.message}</p>}
              </div>

              {submitError && <p role="alert" className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger-text)]">{submitError}</p>}
            </DialogBody>
            <DialogFooter>
              <button type="button" onClick={() => onOpenChange?.(false)} className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-bold text-foreground hover:bg-canvas">
                Cancel
              </button>
              <button type="submit" disabled={isSubmitting} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-bold text-[var(--white)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                {isSubmitting ? 'Sending…' : 'Send request'}
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
