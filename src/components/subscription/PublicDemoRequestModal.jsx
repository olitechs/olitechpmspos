import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Loader2, Send } from 'lucide-react';
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

const PACKAGE_OPTIONS = [
  { value: 'unsure', label: 'Not sure yet' },
  { value: 'starter', label: 'Starter' },
  { value: 'standard', label: 'Standard' },
  { value: 'professional', label: 'Professional' },
  { value: 'enterprise', label: 'Enterprise' },
];

const demoRequestSchema = z.object({
  fullName: z.string().trim().min(2, 'Please enter your name.').max(120, 'Name is too long.'),
  email: z.string().trim().email('Enter a valid email address.').max(254, 'Email is too long.'),
  propertyName: z.string().trim().min(2, 'Please enter your property or business name.').max(160, 'Property name is too long.'),
  phone: z.string().trim().max(60, 'Phone number is too long.').optional().or(z.literal('')),
  packageName: z.string().min(1, 'Choose the package you are interested in.'),
  billingCycle: z.enum(['monthly', 'annual', 'unsure']),
  notes: z.string().trim().max(2000, 'Please keep the message under 2000 characters.').optional().or(z.literal('')),
});

const fieldClass = 'w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-[var(--primary)]';
const labelClass = 'mb-1.5 block text-xs font-bold text-foreground';
const errorClass = 'mt-1 text-xs text-[var(--danger-text)]';

const defaultValues = {
  fullName: '',
  email: '',
  propertyName: '',
  phone: '',
  packageName: 'unsure',
  billingCycle: 'monthly',
  notes: '',
};

/**
 * Public homepage demo/subscription enquiry form.
 *
 * This is deliberately separate from SubscriptionRequestModal: homepage
 * visitors may be anonymous and have no property session. The authenticated
 * subscribe/upgrade/renew workflow keeps its owner/admin guard unchanged.
 */
export default function PublicDemoRequestModal({ open, onOpenChange }) {
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(demoRequestSchema),
    defaultValues,
  });

  useEffect(() => {
    if (!open) return;
    setSubmitError('');
    setResult(null);
    reset(defaultValues);
  }, [open, reset]);

  const onSubmit = async (values) => {
    if (isSubmitting) return;
    setSubmitError('');
    try {
      const response = await pmsService.requestDemo({
        fullName: values.fullName,
        email: values.email,
        propertyName: values.propertyName,
        phone: values.phone || '',
        packageName: values.packageName,
        billingCycle: values.billingCycle,
        notes: values.notes || '',
      });
      setResult(response);
    } catch (error) {
      setSubmitError(error?.message || 'Could not send your request. Please try again.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request a demo</DialogTitle>
          <DialogDescription>
            Tell us about your property and we will arrange a walkthrough of the workflows that matter to you.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <DialogBody>
            <div className="rounded-2xl border border-[var(--success)] bg-[var(--success-soft)] p-4">
              <p className="flex items-center gap-2 font-bold text-[var(--success-text)]">
                <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                {result?.already_requested ? 'Your request is already with us' : 'Demo request sent'}
              </p>
              <p className="mt-2 text-sm text-foreground">
                {result?.already_requested
                  ? 'Our team recently received a request from this email address and will be in touch shortly.'
                  : `Your request is in the OliTechs platform inbox and has been emailed to ${SUBSCRIPTION_SUPPORT_EMAILS.join(' and ')}.`}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">We will contact you to confirm a suitable demo time.</p>
            </div>
          </DialogBody>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogBody className="space-y-4">
              <div>
                <label className={labelClass} htmlFor="demo-name">Your name</label>
                <input id="demo-name" type="text" autoComplete="name" className={fieldClass} placeholder="e.g. Jane Wanjiku" {...register('fullName')} />
                {errors.fullName && <p className={errorClass} role="alert">{errors.fullName.message}</p>}
              </div>

              <div>
                <label className={labelClass} htmlFor="demo-email">Work email</label>
                <input id="demo-email" type="email" autoComplete="email" className={fieldClass} placeholder="you@yourproperty.com" {...register('email')} />
                {errors.email && <p className={errorClass} role="alert">{errors.email.message}</p>}
              </div>

              <div>
                <label className={labelClass} htmlFor="demo-property">Property or business</label>
                <input id="demo-property" type="text" autoComplete="organization" className={fieldClass} placeholder="e.g. Coastal View Hotel" {...register('propertyName')} />
                {errors.propertyName && <p className={errorClass} role="alert">{errors.propertyName.message}</p>}
              </div>

              <div>
                <label className={labelClass} htmlFor="demo-phone">Phone number <span className="font-normal text-muted-foreground">(optional)</span></label>
                <input id="demo-phone" type="tel" autoComplete="tel" className={fieldClass} placeholder="e.g. +254 700 000 000" {...register('phone')} />
                {errors.phone && <p className={errorClass} role="alert">{errors.phone.message}</p>}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="demo-package">Package of interest</label>
                  <select id="demo-package" className={fieldClass} {...register('packageName')}>
                    {PACKAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  {errors.packageName && <p className={errorClass} role="alert">{errors.packageName.message}</p>}
                </div>
                <div>
                  <label className={labelClass} htmlFor="demo-cycle">Billing cycle</label>
                  <select id="demo-cycle" className={fieldClass} {...register('billingCycle')}>
                    <option value="monthly">Monthly</option>
                    <option value="annual">Annual</option>
                    <option value="unsure">Not sure yet</option>
                  </select>
                  {errors.billingCycle && <p className={errorClass} role="alert">{errors.billingCycle.message}</p>}
                </div>
              </div>

              <div>
                <label className={labelClass} htmlFor="demo-notes">What would you like to see? <span className="font-normal text-muted-foreground">(optional)</span></label>
                <textarea id="demo-notes" rows={4} className={fieldClass} placeholder="Tell us about your rooms, restaurant, team size or any questions." {...register('notes')} />
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
