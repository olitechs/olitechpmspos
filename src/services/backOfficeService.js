import { supabase } from '@/lib/supabaseClient';

export const backOfficeService={
 async listPaymentTypes(propertyId){const {data,error}=await supabase.from('property_payment_types').select('*').eq('property_id',propertyId).order('sort_order').order('name');if(error)throw new Error(error.message);return data||[];},
 async savePaymentType(propertyId,row){const {data,error}=await supabase.from('property_payment_types').upsert({...row,property_id:propertyId},{onConflict:'property_id,code'}).select('*').single();if(error)throw new Error(error.message);return data;},
 async deletePaymentType(id,propertyId){const {error}=await supabase.from('property_payment_types').delete().eq('id',id).eq('property_id',propertyId);if(error)throw new Error(error.message);},
 async listTaxes(propertyId){const {data,error}=await supabase.from('property_taxes').select('*').eq('property_id',propertyId).order('name');if(error)throw new Error(error.message);return data||[];},
 async saveTax(propertyId,row){const {data,error}=await supabase.from('property_taxes').upsert({...row,property_id:propertyId},{onConflict:'id'}).select('*').single();if(error)throw new Error(error.message);return data;},
 async deleteTax(id,propertyId){const {error}=await supabase.from('property_taxes').delete().eq('id',id).eq('property_id',propertyId);if(error)throw new Error(error.message);},
 async listDiningOptions(propertyId){const {data,error}=await supabase.from('property_dining_options').select('*').eq('property_id',propertyId).order('name');if(error)throw new Error(error.message);return data||[];},
 async saveDiningOption(propertyId,row){const {data,error}=await supabase.from('property_dining_options').upsert({...row,property_id:propertyId},{onConflict:'property_id,code'}).select('*').single();if(error)throw new Error(error.message);return data;},
 async deleteDiningOption(id,propertyId){const {error}=await supabase.from('property_dining_options').delete().eq('id',id).eq('property_id',propertyId);if(error)throw new Error(error.message);},
 async listOpenTickets(propertyId){const {data,error}=await supabase.from('pos_table_sessions').select('*').eq('property_id',propertyId).in('status',['open','unsettled']).order('updated_at',{ascending:false});if(error)throw new Error(error.message);return data||[];},
 async listLoyalty(propertyId){const {data,error}=await supabase.from('guest_loyalty_accounts').select('*, guest:guests(id,name,email,phone)').eq('property_id',propertyId).order('points_balance',{ascending:false});if(error)throw new Error(error.message);return data||[];},
 async listTimecards(propertyId,from,to){let q=supabase.from('staff_timecards').select('*, staff:staff(id,full_name,role)').eq('property_id',propertyId).order('clock_in',{ascending:false});if(from)q=q.gte('clock_in',from);if(to)q=q.lte('clock_in',to);const {data,error}=await q;if(error)throw new Error(error.message);return data||[];},
 async clockStaff(propertyId,staffId,clockOut,notes){const {data,error}=await supabase.rpc('fn_clock_staff',{p_property_id:propertyId,p_staff_id:staffId,p_clock_out:!!clockOut,p_notes:notes||null});if(error)throw new Error(error.message);return data;},
 async adjustLoyalty(propertyId,guestId,points,type,reference){const {data,error}=await supabase.rpc('fn_adjust_guest_loyalty_points',{p_property_id:propertyId,p_guest_id:guestId,p_points:Number(points),p_type:type,p_reference:reference||null});if(error)throw new Error(error.message);return data;},
};
