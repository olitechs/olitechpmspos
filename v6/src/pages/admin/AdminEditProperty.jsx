import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { platformService } from '@/services/platformService';
import { Button } from '@/components/ui/button';

const empty = {
  name:'', business_name:'', property_type:'Hotel', address:'', city:'', country:'',
  phone:'', email:'', website:'', currency:'USD', timezone:'UTC',
  business_registration:'', contact_person:''
};

export default function AdminEditProperty() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form,setForm]=useState(empty);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{ (async()=>{
    try {
      const p=await platformService.getProperty(id);
      setForm({
        name:p.name||'', business_name:p.business_name||'', property_type:p.property_type||'Hotel',
        address:p.address||'', city:p.city||'', country:p.country||'', phone:p.phone||'',
        email:p.email||'', website:p.website||'', currency:p.currency||'USD',
        timezone:p.timezone||'UTC', business_registration:p.business_registration||'',
        contact_person:p.contact_person||''
      });
    } catch(e){setError(e.message)} finally {setLoading(false)}
  })() },[id]);

  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const submit=async(e)=>{
    e.preventDefault(); setError('');
    if(!form.name.trim()) return setError('Property name is required.');
    setSaving(true);
    try { await platformService.updateProperty({id,...form}); navigate('/admin/properties/'+id); }
    catch(e){setError(e.message)} finally{setSaving(false)}
  };

  if(loading) return <div className="text-sm text-muted-foreground">Loading property...</div>;

  return <div className="max-w-4xl mx-auto space-y-6">
    <Link to={'/admin/properties/'+id} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4"/> Back to property</Link>
    <div><h1 className="text-2xl font-bold">Edit Property</h1><p className="text-sm text-muted-foreground mt-1">Update the platform-level property information.</p></div>
    {error&&<div className="p-4 rounded-xl bg-destructive/10 text-destructive text-sm">{error}</div>}
    <form onSubmit={submit} className="space-y-6">
      <section className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <h2 className="font-semibold">Property Information</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            ['name','Property Name *'],['business_name','Business Name'],['property_type','Property Type'],
            ['contact_person','Contact Person'],['address','Address'],['city','City'],['country','Country'],
            ['phone','Phone'],['email','Property Email'],['website','Website'],
            ['business_registration','Business Registration'],['currency','Currency'],['timezone','Timezone']
          ].map(([k,label])=><label key={k} className="text-sm font-medium">{label}<input type={k==='email'?'email':'text'} value={form[k]} onChange={e=>set(k,e.target.value)} required={k==='name'} className="mt-1 w-full h-10 rounded-lg border border-input px-3 bg-background"/></label>)}
        </div>
      </section>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={()=>navigate('/admin/properties/'+id)}>Cancel</Button><Button type="submit" disabled={saving}><Save className="w-4 h-4 mr-2"/>{saving?'Saving...':'Save Changes'}</Button></div>
    </form>
  </div>;
}
