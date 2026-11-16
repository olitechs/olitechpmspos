// Thin wrapper that binds the injected-client printer cores (printerSetupCore,
// printerAgentPairing) to the real Supabase client, so pages/components never
// import supabaseClient directly (architecture rule — see
// docs/adr/ADR-0004-services-only-data-access.md).
import { supabase } from '@/lib/supabaseClient';
import { savePrinterSetup as persistPrinterSetup } from './printerSetupCore.js';
import {
  createPairingCode,
  pairWorkstation,
  listPairedWorkstations,
  revokePairedWorkstation,
} from './printerAgentPairing.js';

export const printerSetupService = {
  savePrinterSetup(args) {
    return persistPrinterSetup({ client: supabase, ...args });
  },
  createPairingCode(args) {
    return createPairingCode({ client: supabase, ...args });
  },
  pairWorkstation(args) {
    return pairWorkstation({ client: supabase, ...args });
  },
  listPairedWorkstations(args) {
    return listPairedWorkstations({ client: supabase, ...args });
  },
  revokePairedWorkstation(args) {
    return revokePairedWorkstation({ client: supabase, ...args });
  },

  async savePrinter({ propertyId, payload, id = null }) {
    const result = id
      ? await supabase.from('property_printers').update(payload).eq('id', id).eq('property_id', propertyId).select().single()
      : await supabase.from('property_printers').insert(payload).select().single();
    if (result.error) throw result.error;
    return result.data;
  },

  // Record that a saved printer's routing could not be completed so its card
  // does not stay stuck on "Testing…".
  async markPrinterFailed(printerId, propertyId, message) {
    const { error } = await supabase.from('property_printers').update({ last_status: 'failed', last_error: message })
      .eq('id', printerId).eq('property_id', propertyId);
    if (error) throw error;
  },

  async clearPrinterAssignments(printerId, propertyId) {
    const { error } = await supabase.from('printer_assignments').delete()
      .eq('printer_id', printerId).eq('property_id', propertyId);
    if (error) throw error;
  },

  async addPrinterAssignments(propertyId, printerId, assignmentTypes) {
    const { error } = await supabase.from('printer_assignments').insert(
      assignmentTypes.map((type) => ({ property_id: propertyId, printer_id: printerId, assignment_type: type }))
    );
    if (error) throw error;
  },

  async deletePrinter(id, propertyId) {
    const { error } = await supabase.from('property_printers').delete().eq('id', id).eq('property_id', propertyId);
    if (error) throw error;
  },

  async deleteAssignment(assignmentId, propertyId) {
    const { error } = await supabase.from('printer_assignments').delete()
      .eq('id', assignmentId).eq('property_id', propertyId);
    if (error) throw error;
  },

  async createAssignment({ propertyId, printerId, assignmentType: type }) {
    const { error } = await supabase.from('printer_assignments').insert({ property_id: propertyId, printer_id: printerId, assignment_type: type });
    if (error) throw error;
  },
};
