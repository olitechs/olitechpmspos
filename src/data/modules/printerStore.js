// Standalone Zustand slice for printer groups. AppStore.jsx / PmsStore.jsx remain untouched.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { printerGroupService } from '@/services/printerGroupService';

const isLocalId = (id) => String(id).startsWith('local-');
const newLocalId = () => `local-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
const cleanName = (n) => String(n || '').trim();
const sameName = (a,b) => cleanName(a).toLowerCase() === cleanName(b).toLowerCase();
const emptyBucket = () => ({ groups: [], categories: [], queue: [] });

export const usePrinterStore = create(
  persist((set,get) => {
    const commit = (patch) => {
      const { propertyId, cache } = get();
      if (!propertyId) return;
      const bucket = { ...(cache[propertyId] || emptyBucket()), ...patch };
      set({ ...patch, cache: { ...cache, [propertyId]: bucket } });
    };
    const bucket = () => get().cache[get().propertyId] || emptyBucket();
    return {
      propertyId:null, groups:[], categories:[], cache:{}, loading:false, offline:false, error:null,
      pendingCount:()=>bucket().queue.length,
      async hydrate(propertyId) {
        if (!propertyId) return;
        const cached=get().cache[propertyId]||emptyBucket();
        set({propertyId,groups:cached.groups,categories:cached.categories,loading:true,error:null});
        await get().flush();
        try {
          const [categories,groups]=await Promise.all([
            printerGroupService.listCategories(propertyId), printerGroupService.listGroups(propertyId)
          ]);
          const queue=bucket().queue;
          const deleted=new Set(queue.filter(o=>o.type==='delete').flatMap(o=>o.ids));
          const localPending=bucket().groups.filter(g=>isLocalId(g.id)||queue.some(o=>o.type==='save'&&o.group.id===g.id));
          const merged=[...groups.filter(g=>!deleted.has(g.id)&&!localPending.some(l=>l.id===g.id)),...localPending];
          commit({groups:merged,categories});
          set({loading:false,offline:false});
        } catch(e) { set({loading:false,offline:true,error:e.message}); }
      },
      validate(input) {
        const name=cleanName(input.name);
        if(!name) return 'Name is required.';
        if(name.length>80) return 'Name must be 80 characters or fewer.';
        if(get().groups.some(g=>g.id!==input.id&&sameName(g.name,name))) return 'A printer group with this name already exists.';
        return null;
      },
      async saveGroup(input) {
        const problem=get().validate(input); if(problem) throw new Error(problem);
        const group={id:input.id||newLocalId(),name:cleanName(input.name),productionCenter:cleanName(input.productionCenter),categoryIds:[...new Set(input.categoryIds||[])]};
        const {groups,queue}=bucket(); const exists=groups.some(g=>g.id===group.id);
        commit({groups:exists?groups.map(g=>g.id===group.id?group:g):[...groups,group],queue:[...queue.filter(o=>!(o.type==='save'&&o.group.id===group.id)),{type:'save',group}]});
        await get().flush(); return group;
      },
      async deleteGroups(ids) {
        const gone=new Set(ids); const {groups,queue}=bucket(); const realIds=ids.filter(id=>!isLocalId(id));
        commit({groups:groups.filter(g=>!gone.has(g.id)),queue:[...queue.filter(o=>!(o.type==='save'&&gone.has(o.group.id))),...(realIds.length?[{type:'delete',ids:realIds}]:[])]});
        await get().flush();
      },
      async flush() {
        const {propertyId}=get(); if(!propertyId) return;
        let remaining=[...bucket().queue];
        while(remaining.length) {
          const op=remaining[0];
          try {
            if(op.type==='save') {
              const g=op.group;
              const realId=await printerGroupService.saveGroup(propertyId,{...g,id:isLocalId(g.id)?null:g.id});
              if(realId!==g.id) commit({groups:bucket().groups.map(x=>x.id===g.id?{...x,id:realId}:x)});
            } else await printerGroupService.deleteGroups(propertyId,op.ids);
            remaining=remaining.slice(1); commit({queue:remaining}); set({offline:false,error:null});
          } catch(e) { set({offline:true,error:e.message}); return; }
        }
      },
    };
  },{name:'olitech_printer_groups_v1',storage:createJSONStorage(()=>localStorage),partialize:s=>({cache:s.cache})})
);
export const selectGroupCategoryCount=(group)=>(group?.categoryIds||[]).length;
