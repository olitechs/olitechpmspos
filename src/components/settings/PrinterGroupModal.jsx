import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePrinterStore } from '@/data/modules/printerStore';

const CENTER_OPTIONS=['Kitchen','Bar','Dessert'];
const schema=z.object({name:z.string().trim().min(1,'Name is required.').max(80,'Name must be 80 characters or fewer.'),productionCenter:z.string().trim().max(80),categoryIds:z.array(z.string())});
const btn='h-9 rounded-[2px] px-4 text-[14px] font-medium uppercase tracking-wide disabled:opacity-50';

export default function PrinterGroupModal({open,group,onClose}){
  const categories=usePrinterStore(s=>s.categories),saveGroup=usePrinterStore(s=>s.saveGroup),validate=usePrinterStore(s=>s.validate);
  const [query,setQuery]=useState(''),[serverError,setServerError]=useState(''),[saving,setSaving]=useState(false);
  const {register,handleSubmit,reset,setValue,watch,formState:{errors}}=useForm({resolver:zodResolver(schema),defaultValues:{name:'',productionCenter:'',categoryIds:[]}});
  const selected=watch('categoryIds')||[];
  useEffect(()=>{if(!open)return;reset({name:group?.name||'',productionCenter:group?.productionCenter||'',categoryIds:[...(group?.categoryIds||[])]});setQuery('');setServerError('');setSaving(false);},[open,group,reset]);
  const visible=useMemo(()=>{const q=query.trim().toLowerCase();return q?categories.filter(c=>String(c.name).toLowerCase().includes(q)):categories;},[categories,query]);
  const allVisibleSelected=visible.length>0&&visible.every(c=>selected.includes(c.id)),someVisibleSelected=visible.some(c=>selected.includes(c.id));
  const toggle=id=>setValue('categoryIds',selected.includes(id)?selected.filter(x=>x!==id):[...selected,id],{shouldDirty:true});
  const toggleAllVisible=()=>{const next=new Set(selected);visible.forEach(c=>allVisibleSelected?next.delete(c.id):next.add(c.id));setValue('categoryIds',[...next],{shouldDirty:true});};
  const submit=async(values)=>{const problem=validate({id:group?.id,...values});if(problem){setServerError(problem);return;}setSaving(true);setServerError('');try{await saveGroup({id:group?.id,...values});toast.success(group?'Printer group updated':'Printer group added');onClose();}catch(err){setServerError(err.message||'Unable to save printer group.');setSaving(false);}};
  return <Dialog open={open} onOpenChange={o=>{if(!o&&!saving)onClose();}}>
    <DialogContent className="max-w-xl rounded-[2px] p-0"><form onSubmit={handleSubmit(submit)}>
      <DialogHeader className="px-6 pt-6"><DialogTitle className="text-[20px] font-normal text-[#212121]">{group?'Edit printer group':'Add printer group'}</DialogTitle><DialogDescription className="sr-only">Name the group and choose the categories whose items print to it.</DialogDescription></DialogHeader>
      <div className="space-y-5 px-6 py-4">
        <div><Label htmlFor="pg-name" className="text-[12px] text-[#757575]">Name</Label><Input id="pg-name" autoFocus maxLength={80} {...register('name')} className="mt-1 rounded-none border-0 border-b border-[#BDBDBD] px-0 shadow-none focus-visible:border-[#4CAF50] focus-visible:ring-0" placeholder="e.g. KITCHEN POS"/>{(errors.name?.message||serverError)&&<p className="mt-1 text-[13px] text-[#D32F2F]" role="alert">{errors.name?.message||serverError}</p>}</div>
        <div><Label htmlFor="pg-center" className="text-[12px] text-[#757575]">Prints on printers set to</Label><select id="pg-center" {...register('productionCenter')} className="mt-1 h-9 w-full border-0 border-b border-[#BDBDBD] bg-transparent text-sm focus:border-[#4CAF50] focus:outline-none"><option value="">Same as group name</option>{CENTER_OPTIONS.map(c=><option key={c} value={c}>{c}</option>)}</select><p className="mt-1 text-[12px] text-[#9E9E9E]">Matches the production center set on each printer in Settings → Printers.</p></div>
        <div><div className="flex items-center justify-between"><Label className="text-[12px] text-[#757575]">Categories</Label><span className="text-[12px] text-[#757575]" aria-live="polite">{selected.length} of {categories.length} selected</span></div><div className="relative mt-2"><Search size={16} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#9E9E9E]"/><Input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search categories" aria-label="Search categories" className="h-9 pl-8"/></div>
          <div className="mt-2 max-h-64 overflow-y-auto border border-[#E0E0E0]">{categories.length===0?<p className="p-4 text-[14px] text-[#757575]">No categories yet. Add categories to your menu first.</p>:visible.length===0?<p className="p-4 text-[14px] text-[#757575]">No categories match “{query}”.</p>:<><label className="flex cursor-pointer items-center gap-3 border-b border-[#E0E0E0] bg-[#FAFAFA] px-3 py-2.5 text-[14px] text-[#757575]"><Checkbox checked={allVisibleSelected?true:someVisibleSelected?'indeterminate':false} onCheckedChange={toggleAllVisible} aria-label="Select all shown categories"/>{query?'Select all shown':'Select all'}</label>{visible.map(c=><label key={c.id} className="flex cursor-pointer items-center gap-3 border-b border-[#F0F0F0] px-3 py-2.5 text-[14px] text-[#212121] last:border-b-0 hover:bg-[#F5F5F5]"><Checkbox checked={selected.includes(c.id)} onCheckedChange={()=>toggle(c.id)}/>{c.name}</label>)}</>}</div>
        </div>{serverError&&!errors.name&&<p className="text-[13px] text-[#D32F2F]" role="alert">{serverError}</p>}
      </div><DialogFooter className="border-t border-[#E0E0E0] px-6 py-4"><button type="button" onClick={onClose} disabled={saving} className={btn+' text-[#757575] hover:bg-[#F5F5F5]'}>Cancel</button><button type="submit" disabled={saving} className={btn+' bg-[#4CAF50] text-white shadow hover:bg-[#43A047]'}>{saving?'Saving…':'Save'}</button></DialogFooter>
    </form></DialogContent>
  </Dialog>;
}