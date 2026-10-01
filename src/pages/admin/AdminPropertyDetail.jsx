import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, UserPlus, Save, Trash2 } from 'lucide-react';
import { platformService } from '@/services/platformService';
import { PACKAGE_LABELS } from '@/lib/entitlements';
import { Button } from '@/components/ui/button';
import PackageAssignmentModal from './PackageAssignmentModal';

const ROLES=['owner','admin','manager','reception','cashier','waiter','kitchen','housekeeping','maintenance','accountant','storekeeper'];
const SUB_STATUSES=['trial','active','past_due','suspended','cancelled'];

const isoInput=(v)=>v ? new Date(v).toISOString().slice(0,16) : '';

export default function AdminPropertyDetail() {
  const { id }=useParams();
  const [property,setProperty]=useState(null);
  const [members,setMembers]=useState([]);
  const [auditLog,setAuditLog]=useState([]);
  const [subscription,setSubscription]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [packageDialog,setPackageDialog]=useState(null);
  const [ownerEmail,setOwnerEmail]=useState('');
  const [memberEmail,setMemberEmail]=useState('');
  const [memberRole,setMemberRole]=useState('admin');
  const [subForm,setSubForm]=useState({planCode:'starter',status:'trial',trialEndsAt:'',currentPeriodEndsAt:'',graceEndsAt:'',modules:''});

  const load=useCallback(async()=>{
    setLoading(true); setError('');
    try{
      const [p,m,log,s]=await Promise.all([
        platformService.getProperty(id),
        platformService.listPropertyMembers(id),
        platformService.listAuditLog(id),
        platformService.getSubscription(id)
      ]);
      setProperty(p); setMembers(m); setAuditLog(log); setSubscription(s);
      if(s) setSubForm({
        planCode:s.plan_code||'starter',status:s.status||'trial',
        trialEndsAt:isoInput(s.trial_ends_at),currentPeriodEndsAt:isoInput(s.current_period_ends_at),
        graceEndsAt:isoInput(s.grace_ends_at),modules:(s.enabled_modules||[]).join(', ')
      });
      const owner=m.find(x=>x.role==='owner'); setOwnerEmail(owner?.email||'');
    }catch(e){setError(e.message)}finally{setLoading(false)}
  },[id]);
  useEffect(()=>{load()},[load]);

  const run=async(fn)=>{setBusy(true);setError('');try{await fn();await load()}catch(e){setError(e.message)}finally{setBusy(false)}};

  const setStatus=(status)=>run(()=>platformService.setStatusManaged(id,status));
  const setPackage=(pkg)=>run(()=>platformService.setPackageManaged(id,pkg));

  const assignOwner=async()=>{
    if(!ownerEmail.trim()) return setError('Enter an owner email.');
    await run(async()=>{const u=await platformService.findUserByEmail(ownerEmail);if(!u)throw new Error('No registered user found with that email.');await platformService.assignOwner(id,u.id)});
  };

  const addMember=async()=>{
    if(!memberEmail.trim()) return setError('Enter a member email.');
    await run(async()=>{const u=await platformService.findUserByEmail(memberEmail);if(!u)throw new Error('No registered user found with that email.');await platformService.setPropertyMember(id,u.id,memberRole);setMemberEmail('')});
  };

  const removeMember=(userId)=>{if(window.confirm('Remove this member from the property?'))run(()=>platformService.removePropertyMember(id,userId))};

  const saveSubscription=()=>run(()=>platformService.updateSubscription({
    propertyId:id,planCode:subForm.planCode,status:subForm.status,
    trialEndsAt:subForm.trialEndsAt||null,currentPeriodEndsAt:subForm.currentPeriodEndsAt||null,
    graceEndsAt:subForm.graceEndsAt||null,
    enabledModules:subForm.modules.split(',').map(x=>x.trim()).filter(Boolean)
  }));

  if(loading)return <div className="text-muted-foreground text-sm">Loading property...</div>;
  if(!property)return <div className="p-4 rounded-xl bg-destructive/10 text-destructive text-sm">{error||'Property not found.'}</div>;

  return <div className="space-y-6">
    <Link to="/admin/properties" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4"/> Back to properties</Link>

    <div className="flex items-start justify-between gap-4">
      <div><h1 className="text-2xl font-bold">{property.name}</h1><p className="text-sm text-muted-foreground mt-1 capitalize">{property.status} · {PACKAGE_LABELS[property.package]}</p></div>
      <Link to={'/admin/properties/'+id+'/edit'} className="inline-flex items-center rounded-lg border border-input px-4 py-2 text-sm font-medium hover:bg-muted">Edit Property</Link>
    </div>

    {error&&<div className="p-4 rounded-xl bg-destructive/10 text-destructive text-sm">{error}</div>}

    <section className="grid md:grid-cols-2 gap-4">
      <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <h2 className="font-semibold">Property Access</h2>
        <div className="grid grid-cols-2 gap-2">
          {['pending','active','suspended','rejected','inactive'].map(s=><Button key={s} size="sm" variant={property.status===s?'default':'outline'} disabled={busy||property.status===s} onClick={()=>setStatus(s)} className="capitalize">{s}</Button>)}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {['none','standard','premium','professional'].map(p=><Button key={p} size="sm" variant={property.package===p?'default':'outline'} disabled={busy||property.package===p} onClick={()=>setPackage(p)}>{PACKAGE_LABELS[p]}</Button>)}
        </div>
      </div>
      <div className="bg-card border border-border rounded-2xl p-5">
        <h2 className="font-semibold mb-3">Property Information</h2>
        <dl className="text-sm space-y-2">{[['Business Name',property.business_name],['Type',property.property_type],['Address',property.address],['City',property.city],['Country',property.country],['Phone',property.phone],['Email',property.email],['Currency',property.currency],['Timezone',property.timezone]].map(([l,v])=><div key={l} className="flex justify-between gap-4"><dt className="text-muted-foreground">{l}</dt><dd className="font-medium text-right">{v||'—'}</dd></div>)}</dl>
      </div>
    </section>

    <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div><h2 className="font-semibold">Property Owner</h2><p className="text-xs text-muted-foreground mt-1">Assign an existing authenticated user. Passwords are never handled here.</p></div>
      <div className="flex gap-2"><input value={ownerEmail} onChange={e=>setOwnerEmail(e.target.value)} type="email" placeholder="owner@example.com" className="flex-1 h-10 rounded-lg border border-input px-3 bg-background"/><Button disabled={busy} onClick={assignOwner}>Assign Owner</Button></div>
      <div className="text-sm text-muted-foreground">Current: {members.find(m=>m.role==='owner')?.email||'Not assigned'}</div>
    </section>

    <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div><h2 className="font-semibold">Property Members & Roles</h2><p className="text-xs text-muted-foreground mt-1">Add or change access for an existing registered user.</p></div>
      <div className="flex gap-2"><input value={memberEmail} onChange={e=>setMemberEmail(e.target.value)} type="email" placeholder="staff@example.com" className="flex-1 h-10 rounded-lg border border-input px-3 bg-background"/><select value={memberRole} onChange={e=>setMemberRole(e.target.value)} className="h-10 rounded-lg border border-input px-3 bg-background">{ROLES.map(r=><option key={r}>{r}</option>)}</select><Button disabled={busy} onClick={addMember}><UserPlus className="w-4 h-4 mr-1"/>Add</Button></div>
      <div className="divide-y divide-border">{members.map(m=><div key={m.user_id} className="py-3 flex items-center justify-between gap-3"><div><div className="font-medium text-sm">{m.full_name||m.email}</div><div className="text-xs text-muted-foreground">{m.email}</div></div><div className="flex items-center gap-2"><select value={m.role} disabled={busy} onChange={e=>run(()=>platformService.setPropertyMember(id,m.user_id,e.target.value))} className="h-9 rounded-lg border border-input px-2 bg-background text-sm">{ROLES.map(r=><option key={r}>{r}</option>)}</select><Button size="sm" variant="outline" disabled={busy||m.role==='owner'} onClick={()=>removeMember(m.user_id)}><Trash2 className="w-4 h-4"/></Button></div></div>)}{members.length===0&&<div className="py-3 text-sm text-muted-foreground">No members assigned.</div>}</div>
    </section>

    <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div><h2 className="font-semibold">Subscription & Module Entitlements</h2><p className="text-xs text-muted-foreground mt-1">Empty module list means no subscription-level allowlist. When modules are listed, access is restricted to those module keys.</p></div>
      <div className="grid md:grid-cols-2 gap-4">
        <label className="text-sm font-medium">Plan Code<input value={subForm.planCode} onChange={e=>setSubForm(f=>({...f,planCode:e.target.value}))} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background"/></label>
        <label className="text-sm font-medium">Subscription Status<select value={subForm.status} onChange={e=>setSubForm(f=>({...f,status:e.target.value}))} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background">{SUB_STATUSES.map(s=><option key={s}>{s}</option>)}</select></label>
        {[
          ['trialEndsAt','Trial Ends'],['currentPeriodEndsAt','Current Period Ends'],['graceEndsAt','Grace Ends']
        ].map(([k,l])=><label key={k} className="text-sm font-medium">{l}<input type="datetime-local" value={subForm[k]} onChange={e=>setSubForm(f=>({...f,[k]:e.target.value}))} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background"/></label>)}
        <label className="text-sm font-medium md:col-span-2">Enabled Module Keys<input value={subForm.modules} onChange={e=>setSubForm(f=>({...f,modules:e.target.value}))} placeholder="inventory, revenue_analytics, maintenance" className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background"/></label>
      </div>
      <Button disabled={busy} onClick={saveSubscription}><Save className="w-4 h-4 mr-2"/>Save Subscription</Button>
      {subscription&&<div className="text-xs text-muted-foreground">Last updated: {subscription.updated_at?new Date(subscription.updated_at).toLocaleString():'—'}</div>}
    </section>

    <section className="bg-card border border-border rounded-2xl p-5">
      <h2 className="font-semibold mb-3">Recent Activity</h2>
      <ul className="text-sm space-y-2">{auditLog.map(e=><li key={e.id} className="flex justify-between gap-4 text-muted-foreground"><span><span className="text-foreground">{e.action.replace(/_/g,' ')}</span> by {e.actor_full_name||e.actor_email||'system'}</span><span>{new Date(e.created_at).toLocaleString()}</span></li>)}{auditLog.length===0&&<li className="text-muted-foreground">No activity recorded yet.</li>}</ul>
    </section>

    {packageDialog&&<PackageAssignmentModal property={property} mode={packageDialog.mode} busy={busy} onClose={()=>setPackageDialog(null)} onConfirm={(pkg)=>{setPackageDialog(null);setPackage(pkg)}}/>}
  </div>;
}
