import {usePrinterStore} from '@/data/modules/printerStore';
import {usePrinterStore as usePrinterStoreV2} from '@/data/modules/printerStore';
import {isFeatureEnabled} from '@/lib/featureFlags';
import {supabase} from '@/lib/supabaseClient';
import {groupsForCategory,planPrinterJobs as planJobs,splitLinesByPrinterGroup as splitLines,pickOrderPrinter,groupCenter,resolveCategoryId} from '@/services/printRoutingCore';
export {pickOrderPrinter,groupCenter,resolveCategoryId};
export function isPrinterGroupRoutingEnabled(){return isFeatureEnabled('printerGroupRouting');}
export function getPrinterGroupsForItem(categoryId,groups=usePrinterStore.getState().groups){return groupsForCategory(categoryId,groups);}
export function splitLinesByPrinterGroup(lines,opts={}){const {groups,categories}=usePrinterStore.getState();return splitLines(lines,{groups,categories,...opts});}
export function planPrinterJobs(lines,opts={}){const {groups,categories}=usePrinterStore.getState();return planJobs(lines,{groups,categories,...opts});}
const encode=s=>btoa(unescape(encodeURIComponent(String(s||''))));
const ticket=(items,type)=>[(type==='receipt'?'OLITECHS RECEIPT':'KITCHEN ORDER'),'------------------------------',...(items||[]).map(x=>`${x.qty||1} x ${x.name}`),'','',''].join('\n');
export async function printOrder(order){
 const s=usePrinterStoreV2.getState(); const grouped=s.splitOrderByPrinterGroups(order?.items||[]); const jobs=[];
 for(const [groupId,items] of grouped){const g=s.printerGroups.find(x=>x.id===groupId);for(const p of s.printers.filter(x=>(g?.printerIds||[]).includes(x.id))){const {data,error}=await supabase.from('print_jobs').insert({workspace_id:s.workspaceId,printer_id:p.id,printer_group_id:groupId,order_id:order?.id||null,content_escpos_base64:encode(ticket(items,'kitchen')),type:'kitchen'}).select().single();if(error)throw new Error(error.message);jobs.push(data);}}
 for(const p of s.printers.filter(x=>x.is_receipt)){const {data,error}=await supabase.from('print_jobs').insert({workspace_id:s.workspaceId,printer_id:p.id,order_id:order?.id||null,content_escpos_base64:encode(ticket(order?.items||[],'receipt')),type:'receipt'}).select().single();if(error)throw new Error(error.message);jobs.push(data);}
 return jobs;
}