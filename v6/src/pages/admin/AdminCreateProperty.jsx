import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, UserRound, CheckCircle2 } from 'lucide-react';
import { platformService } from '@/services/platformService';
import { Button } from '@/components/ui/button';

const initial = {
  name: '', business_name: '', property_type: 'Hotel', address: '', city: '',
  country: 'Kenya', phone: '', email: '', website: '', currency: 'USD',
  timezone: 'Africa/Nairobi', business_registration: '', contact_person: '',
  status: 'active', package: 'standard', owner_email: ''
};

export default function AdminCreateProperty() {
  const navigate = useNavigate();
  const [form, setForm] = useState(initial);
  const [owner, setOwner] = useState(null);
  const [ownerChecked, setOwnerChecked] = useState(false);
  const [loadingOwner, setLoadingOwner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const findOwner = async () => {
    setError('');
    setOwner(null);
    setOwnerChecked(false);
    if (!form.owner_email.trim()) return;
    setLoadingOwner(true);
    try {
      const result = await platformService.findUserByEmail(form.owner_email);
      setOwner(result || null);
      setOwnerChecked(true);
      if (!result) setError('No registered user was found with that email. Create the user in Supabase Authentication first, then try again.');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingOwner(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Property name is required.');
    if (form.owner_email.trim() && !owner) return setError('Verify the owner email before creating the property.');
    setSaving(true);
    try {
      const property = await platformService.createProperty({
        ...form,
        ownerUserId: owner?.id || null,
      });
      setCreated(property);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (created) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-card border border-border rounded-2xl p-8 text-center">
          <CheckCircle2 className="w-14 h-14 mx-auto text-emerald-600" />
          <h1 className="text-2xl font-bold mt-4">Property Created</h1>
          <p className="text-muted-foreground mt-2">{created.name} is now available in the platform.</p>
          <div className="flex justify-center gap-2 mt-6">
            <Button onClick={() => navigate('/admin/properties')}>View Properties</Button>
            <Button variant="outline" onClick={() => { setCreated(null); setForm(initial); setOwner(null); setOwnerChecked(false); }}>Create Another</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link to="/admin/properties" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back to properties
      </Link>

      <div>
        <div className="flex items-center gap-2">
          <Building2 className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Add Property</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">Create a property directly as Platform Owner and optionally assign an existing registered user as owner.</p>
      </div>

      {error && <div className="p-4 rounded-xl bg-destructive/10 text-destructive text-sm">{error}</div>}

      <form onSubmit={submit} className="space-y-6">
        <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <h2 className="font-semibold">Property Information</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <label className="text-sm font-medium">Property Name *
              <input value={form.name} onChange={e=>set('name',e.target.value)} required className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background" />
            </label>
            <label className="text-sm font-medium">Business Name
              <input value={form.business_name} onChange={e=>set('business_name',e.target.value)} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background" />
            </label>
            <label className="text-sm font-medium">Property Type
              <input value={form.property_type} onChange={e=>set('property_type',e.target.value)} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background" />
            </label>
            <label className="text-sm font-medium">Contact Person
              <input value={form.contact_person} onChange={e=>set('contact_person',e.target.value)} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background" />
            </label>
            <label className="text-sm font-medium md:col-span-2">Address
              <input value={form.address} onChange={e=>set('address',e.target.value)} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background" />
            </label>
            <label className="text-sm font-medium">City
              <input value={form.city} onChange={e=>set('city',e.target.value)} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background" />
            </label>
            <label className="text-sm font-medium">Country
              <input value={form.country} onChange={e=>set('country',e.target.value)} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background" />
            </label>
            <label className="text-sm font-medium">Phone
              <input value={form.phone} onChange={e=>set('phone',e.target.value)} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background" />
            </label>
            <label className="text-sm font-medium">Property Email
              <input type="email" value={form.email} onChange={e=>set('email',e.target.value)} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background" />
            </label>
            <label className="text-sm font-medium">Website
              <input value={form.website} onChange={e=>set('website',e.target.value)} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background" />
            </label>
            <label className="text-sm font-medium">Business Registration
              <input value={form.business_registration} onChange={e=>set('business_registration',e.target.value)} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background" />
            </label>
          </div>
        </section>

        <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <h2 className="font-semibold">Access & Package</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <label className="text-sm font-medium">Status
              <select value={form.status} onChange={e=>set('status',e.target.value)} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background">
                <option value="active">Active</option><option value="pending">Pending</option><option value="suspended">Suspended</option><option value="inactive">Inactive</option>
              </select>
            </label>
            <label className="text-sm font-medium">Package
              <select value={form.package} onChange={e=>set('package',e.target.value)} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background">
                <option value="standard">Standard</option><option value="premium">Premium</option><option value="professional">Professional</option><option value="none">None</option>
              </select>
            </label>
            <label className="text-sm font-medium">Currency
              <input value={form.currency} onChange={e=>set('currency',e.target.value.toUpperCase())} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background" />
            </label>
            <label className="text-sm font-medium">Timezone
              <input value={form.timezone} onChange={e=>set('timezone',e.target.value)} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background" />
            </label>
          </div>
        </section>

        <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2"><UserRound className="w-5 h-5" /><h2 className="font-semibold">Assign Existing Owner</h2></div>
          <p className="text-sm text-muted-foreground">Enter the email of a user who already exists in Supabase Authentication. This screen does not create passwords or Auth users.</p>
          <div className="flex gap-2">
            <input type="email" value={form.owner_email} onChange={e=>{set('owner_email',e.target.value);setOwner(null);setOwnerChecked(false)}} placeholder="owner@example.com" className="flex-1 h-10 rounded-lg border border-input px-3 bg-background" />
            <Button type="button" variant="outline" onClick={findOwner} disabled={loadingOwner}>{loadingOwner?'Checking…':'Find User'}</Button>
          </div>
          {ownerChecked && owner && <div className="rounded-lg bg-emerald-50 text-emerald-800 p-3 text-sm">Owner found: <strong>{owner.full_name || owner.email}</strong> · {owner.email}</div>}
          {ownerChecked && !owner && <div className="rounded-lg bg-amber-50 text-amber-800 p-3 text-sm">No matching registered user.</div>}
        </section>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={()=>navigate('/admin/properties')}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving?'Creating…':'Create Property'}</Button>
        </div>
      </form>
    </div>
  );
}
