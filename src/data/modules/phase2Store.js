import { create } from 'zustand';
import { phase2CatalogueService } from '@/services/phase2CatalogueService';
export const usePhase2Store=create((set,get)=>({
 propertyId:null,modifierGroups:[],discounts:[],suppliers:[],loading:false,error:null,
 async hydrate(propertyId){if(!propertyId)return;set({propertyId,loading:true,error:null});try{const [modifierGroups,discounts,suppliers]=await Promise.all([phase2CatalogueService.listModifierGroups(propertyId),phase2CatalogueService.listDiscounts(propertyId),phase2CatalogueService.listSuppliers(propertyId)]);set({modifierGroups,discounts,suppliers,loading:false});}catch(e){set({loading:false,error:e.message});}},
 async saveModifierGroup(v){const r=await phase2CatalogueService.saveModifierGroup(get().propertyId,v);await get().hydrate(get().propertyId);return r;},
 async deleteModifierGroups(ids){await phase2CatalogueService.deleteModifierGroups(get().propertyId,ids);await get().hydrate(get().propertyId);},
 async saveDiscount(v){const r=await phase2CatalogueService.saveDiscount(get().propertyId,v);await get().hydrate(get().propertyId);return r;},
 async deleteDiscounts(ids){await phase2CatalogueService.deleteDiscounts(get().propertyId,ids);await get().hydrate(get().propertyId);},
 async saveSupplier(v){const r=await phase2CatalogueService.saveSupplier(get().propertyId,v);await get().hydrate(get().propertyId);return r;},
 async deleteSuppliers(ids){await phase2CatalogueService.deleteSuppliers(get().propertyId,ids);await get().hydrate(get().propertyId);}
}));