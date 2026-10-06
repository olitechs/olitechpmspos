import {usePrinterStore} from '@/data/modules/printerStore';
import {usePrinterStore as usePrinterStoreV2} from '@/data/modules/printerStore';
import {isFeatureEnabled} from '@/lib/featureFlags';
import {supabase} from '@/lib/supabaseClient';
import {groupsForCategory,planPrinterJobs as planJobs,splitLinesByPrinterGroup as splitLines,pickOrderPrinter,groupCenter,resolveCategoryId} from '@/services/printRoutingCore';
export {pickOrderPrinter,groupCenter,resolveCategoryId};
export function isPrinterGroupRoutingEnabled(){return isFeatureEnabled('printerGroupRouting');}
export function getPrinterGroupsForItem(categoryId){return usePrinterStore.getState().getPrinterGroupsForCategory(categoryId);}
export function splitLinesByPrinterGroup(lines=[]){const groups=usePrinterStore.getState().printerGroups||[];const buckets=new Map();const unrouted=[];for(const line of lines){const matched=groups.filter(g=>(g.categoryIds||[]).includes(line.categoryId||line.category_id||line.category));if(!matched.length){unrouted.push(line);continue;}for(const g of matched){if(!buckets.has(g.id))buckets.set(g.id,{group:g,lines:[]});buckets.get(g.id).lines.push(line);}}return {buckets:[...buckets.values()],unrouted};}
export function planPrinterJobs(lines=[]){const {printerGroups,printers}=usePrinterStore.getState();const {buckets,unrouted}=splitLinesByPrinterGroup(lines);return {jobs:buckets.map(({group,lines:groupLines})=>({groupId:group.id,groupName:group.name,center:groupCenter(group),printers:printers.filter(p=>(group.printerIds||[]).includes(p.id)),lines:groupLines})),unrouted};}
const encode=s=>btoa(unescape(encodeURIComponent(String(s||''))));
const ticket=(items,type)=>[(type==='receipt'?'OLITECHS RECEIPT':'KITCHEN ORDER'),'------------------------------',...(items||[]).map(x=>`${x.qty||1} x ${x.name}`),'','',''].join('\n');
export async function printOrder(order){
 const s=usePrinterStoreV2.getState(); const grouped=s.splitOrderByPrinterGroups(order?.items||[]); const jobs=[];
 for(const [groupId,items] of grouped){const g=s.printerGroups.find(x=>x.id===groupId);for(const p of s.printers.filter(x=>(g?.printerIds||[]).includes(x.id))){const {data,error}=await supabase.from('print_jobs').insert({workspace_id:s.workspaceId,printer_id:p.id,printer_group_id:groupId,order_id:order?.id||null,content_escpos_base64:encode(ticket(items,'kitchen')),type:'kitchen'}).select().single();if(error)throw new Error(error.message);jobs.push(data);}}
 for(const p of s.printers.filter(x=>x.is_receipt)){const {data,error}=await supabase.from('print_jobs').insert({workspace_id:s.workspaceId,printer_id:p.id,order_id:order?.id||null,content_escpos_base64:encode(ticket(order?.items||[],'receipt')),type:'receipt'}).select().single();if(error)throw new Error(error.message);jobs.push(data);}
 return jobs;
}