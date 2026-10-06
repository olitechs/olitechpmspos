import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase } from '@/lib/supabaseClient';

const id=()=>globalThis.crypto?.randomUUID?.()||String(Date.now());
export const usePrinterStore=create(persist((set,get)=>({
 stores:[],storeId:null,propertyId:null,workspaceId:null,printers:[],printAgents:[],printerGroups:[],loading:false,error:null,
 async hydrate(storeId){
  if(!storeId)return;
  set({storeId,loading:true,error:null});
  try{
   const [{data:stores},{data:groups},{data:printers},{data:agents}]=await Promise.all([
    supabase.from('stores').select('*').order('is_default',{ascending:false}).order('name'),
    supabase.from('printer_groups').select('*').eq('store_id',storeId).order('name'),
    supabase.from('printers').select('*').eq('store_id',storeId).order('name'),
    supabase.from('print_agents').select('*').order('last_seen',{ascending:false})
   ]);
   const store=(stores||[]).find(s=>s.id===storeId);
   const ids=(groups||[]).map(g=>g.id);
   let links=[],cats=[];
   if(ids.length){
    const a=await supabase.from('printer_group_categories').select('printer_group_id,category_id').in('printer_group_id',ids); if(a.error)throw a.error; cats=a.data||[];
    const b=await supabase.from('printer_group_printers').select('printer_group_id,printer_id').in('printer_group_id',ids); if(b.error)throw b.error; links=b.data||[];
   }
   set({stores:stores||[],propertyId:store?.property_id||null,workspaceId:store?.workspace_id||null,printers:printers||[],printAgents:agents||[],printerGroups:(groups||[]).map(g=>({...g,categoryIds:cats.filter(x=>x.printer_group_id===g.id).map(x=>x.category_id),categoryCount:cats.filter(x=>x.printer_group_id===g.id).length,printerIds:links.filter(x=>x.printer_group_id===g.id).map(x=>x.printer_id)})),loading:false});
  }catch(e){set({loading:false,error:e.message})}
 },
 async addPrinterGroup(input){
  const {storeId,workspaceId}=get(); if(!storeId||!workspaceId)throw new Error('Select a store first.');
  const {data,error}=await supabase.from('printer_groups').insert({workspace_id:workspaceId,store_id:storeId,property_id:get().propertyId,name:String(input.name||'').trim()}).select().single(); if(error)throw new Error(error.message);
  await get().saveLinks(data.id,input.categoryIds||[],input.printerIds||[]); await get().hydrate(storeId); return data;
 },
 async updatePrinterGroup(input){
  const {error}=await supabase.from('printer_groups').update({name:String(input.name||'').trim()}).eq('id',input.id);if(error)throw new Error(error.message);
  await get().saveLinks(input.id,input.categoryIds||[],input.printerIds||[]);await get().hydrate(get().storeId);
 },
 async saveLinks(groupId,categoryIds,printerIds){
  await supabase.from('printer_group_categories').delete().eq('printer_group_id',groupId);
  await supabase.from('printer_group_printers').delete().eq('printer_group_id',groupId);
  if(categoryIds.length){const {error}=await supabase.from('printer_group_categories').insert(categoryIds.map(category_id=>({printer_group_id:groupId,category_id,property_id:get().propertyId})));if(error)throw new Error(error.message)}
  if(printerIds.length){const {error}=await supabase.from('printer_group_printers').insert(printerIds.map(printer_id=>({printer_group_id:groupId,printer_id})));if(error)throw new Error(error.message)}
 },
 async deletePrinterGroup(groupId){const {error}=await supabase.from('printer_groups').delete().eq('id',groupId);if(error)throw new Error(error.message);await get().hydrate(get().storeId)},
 async addPrinter(input){const {storeId,workspaceId}=get();const {data,error}=await supabase.from('printers').insert({id:id(),workspace_id:workspaceId,store_id:storeId,name:input.name,connection_type:input.connectionType||'network',ip_address:input.ipAddress||null,port:Number(input.port||9100),mac_address:input.macAddress||null,is_kitchen:!!input.isKitchen,is_receipt:!!input.isReceipt,status:'offline'}).select().single();if(error)throw new Error(error.message);await get().hydrate(storeId);return data},
 async updateStatus(printerId,status){const {data,error}=await supabase.from('printers').update({status,last_seen:status==='online'?new Date().toISOString():undefined}).eq('id',printerId).select().single();if(error)throw new Error(error.message);set(s=>({printers:s.printers.map(p=>p.id===printerId?data:p)}));},
 async pairPrinter(agentId,info){const p=await get().addPrinter({...info,connectionType:info.connectionType||'network'});const {error}=await supabase.from('printers').update({agent_id:agentId,status:'online',last_seen:new Date().toISOString()}).eq('id',p.id);if(error)throw new Error(error.message);await get().hydrate(get().storeId);return p},
 getPrinterGroupsForCategory(categoryId){return get().printerGroups.filter(g=>(g.categoryIds||[]).includes(categoryId))},
 splitOrderByPrinterGroups(items=[]){const out=new Map();for(const item of items){const groups=get().getPrinterGroupsForCategory(item.categoryId||item.category_id||item.category);if(groups.length)for(const g of groups){if(!out.has(g.id))out.set(g.id,[]);out.get(g.id).push(item)}}return out}
}),{name:'olitech-printer-store',storage:createJSONStorage(()=>localStorage)}));

export const selectGroupCategoryCount=(group)=>(group?.categoryIds||[]).length;
