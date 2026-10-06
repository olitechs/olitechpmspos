import React,{useEffect,useState} from 'react';
import {CloudOff} from 'lucide-react';
import {toast} from 'sonner';
import {Checkbox} from '@/components/ui/checkbox';
import {Dialog,DialogContent,DialogFooter,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {useAuth} from '@/lib/AuthContext';
import {usePrinterStore,selectGroupCategoryCount} from '@/data/modules/printerStore';
import PrinterGroupModal from '@/components/settings/PrinterGroupModal';

export default function KitchenPrintersPage(){
  const {user}=useAuth();const propertyId=user?.property?.id;
  const groups=usePrinterStore(s=>s.groups),loading=usePrinterStore(s=>s.loading),offline=usePrinterStore(s=>s.offline),pending=usePrinterStore(s=>s.cache[s.propertyId]?.queue?.length||0);
  const hydrate=usePrinterStore(s=>s.hydrate),flush=usePrinterStore(s=>s.flush),deleteGroups=usePrinterStore(s=>s.deleteGroups);
  const [modal,setModal]=useState({open:false,group:null}),[selected,setSelected]=useState(new Set()),[confirmDelete,setConfirmDelete]=useState(false);
  useEffect(()=>{if(propertyId)hydrate(propertyId);},[propertyId,hydrate]);
  useEffect(()=>{const retry=()=>flush();window.addEventListener('online',retry);return()=>window.removeEventListener('online',retry);},[flush]);
  useEffect(()=>{setSelected(prev=>{const ids=new Set(groups.map(g=>g.id));const next=new Set([...prev].filter(id=>ids.has(id)));return next.size===prev.size?prev:next;});},[groups]);
  const allSelected=groups.length>0&&selected.size===groups.length;
  const toggleAll=()=>setSelected(allSelected?new Set():new Set(groups.map(g=>g.id)));
  const toggleOne=id=>setSelected(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next;});
  const runDelete=async()=>{const ids=[...selected];setConfirmDelete(false);try{await deleteGroups(ids);setSelected(new Set());toast.success(ids.length===1?'Printer group deleted':`${ids.length} printer groups deleted`);}catch(e){toast.error(e.message||'Unable to delete printer groups.');}};
  return <div className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)]">
    <div className="flex flex-wrap items-center gap-3 px-6 pb-2 pt-6">
      <button type="button" onClick={()=>setModal({open:true,group:null})} className="h-[45px] rounded-[2px] bg-[#8BC34A] px-5 text-[16px] font-medium uppercase text-white shadow-[0_2px_4px_rgba(0,0,0,0.25)] hover:bg-[#7CB342]">+ Add printer group</button>
      {selected.size>0&&<button type="button" onClick={()=>setConfirmDelete(true)} className="h-[45px] rounded-[2px] px-4 text-[16px] font-medium uppercase text-[#D32F2F] hover:bg-[#FDECEA]">Delete ({selected.size})</button>}
      {(offline||pending>0)&&<span className="ml-auto flex items-center gap-1.5 text-[13px] text-[#8D6E00]" role="status"><CloudOff size={15}/>{pending>0?`${pending} change${pending===1?'':'s'} waiting to sync`:'Offline — showing saved data'}</span>}
    </div>
    <table className="w-full border-collapse text-left"><thead><tr className="h-[60px] border-b border-[#E0E0E0] text-[14px] text-[#757575]"><th className="w-[62px] pl-6 font-medium"><Checkbox checked={allSelected?true:selected.size?'indeterminate':false} onCheckedChange={toggleAll} aria-label="Select all printer groups"/></th><th className="pl-4 font-medium">Name</th><th className="pr-8 text-right font-medium">Categories</th></tr></thead>
      <tbody>{groups.map(g=><tr key={g.id} onClick={()=>setModal({open:true,group:g})} onKeyDown={e=>{if(e.key==='Enter')setModal({open:true,group:g});}} tabIndex={0} className="h-[70px] cursor-pointer border-b border-[#E0E0E0] text-[16px] text-[#212121] last:border-b-0 hover:bg-[#F5F5F5] focus:bg-[#F5F5F5] focus:outline-none"><td className="pl-6" onClick={e=>e.stopPropagation()}><Checkbox checked={selected.has(g.id)} onCheckedChange={()=>toggleOne(g.id)} aria-label={`Select ${g.name}`}/></td><td className="pl-4">{g.name}</td><td className="pr-8 text-right">{selectGroupCategoryCount(g)}</td></tr>)}</tbody>
    </table>
    {!groups.length&&<p className="px-6 pb-8 pt-6 text-[14px] text-[#757575]">{loading?'Loading printer groups…':'No printer groups yet. Add one to send items from chosen categories to a specific printer.'}</p>}
    <PrinterGroupModal open={modal.open} group={modal.group} onClose={()=>setModal({open:false,group:null})}/>
    <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}><DialogContent className="max-w-sm rounded-[2px]"><DialogHeader><DialogTitle className="font-normal">Delete printer {selected.size===1?'group':'groups'}?</DialogTitle><DialogDescription>Items in these categories will print using the default routing again. Categories themselves are not deleted.</DialogDescription></DialogHeader><DialogFooter><button type="button" onClick={()=>setConfirmDelete(false)} className="h-9 px-4 text-[14px] font-medium uppercase text-[#757575] hover:bg-[#F5F5F5]">Cancel</button><button type="button" onClick={runDelete} className="h-9 px-4 text-[14px] font-medium uppercase text-[#D32F2F] hover:bg-[#FDECEA]">Delete</button></DialogFooter></DialogContent></Dialog>
  </div>;
}