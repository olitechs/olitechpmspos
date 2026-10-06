import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useInventoryStore = create(persist((set,get)=>({
 purchaseOrders:[], transferOrders:[], stockAdjustments:[], inventoryCounts:[], productions:[], suppliers:[], history:[], valuation:[],
 setCollection:(key,rows)=>set({[key]:Array.isArray(rows)?rows:[]}),
 add:(key,row)=>set(s=>({[key]:[...(s[key]||[]),row]})),
 update:(key,id,patch)=>set(s=>({[key]:(s[key]||[]).map(x=>x.id===id?{...x,...patch}:x)})),
 remove:(key,id)=>set(s=>({[key]:(s[key]||[]).filter(x=>x.id!==id)})),
 clear:()=>set({purchaseOrders:[],transferOrders:[],stockAdjustments:[],inventoryCounts:[],productions:[],suppliers:[],history:[],valuation:[]}),
}),{name:'olitech-inventory-store'}));
