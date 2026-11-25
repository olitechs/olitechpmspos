import { supabase } from '@/lib/supabaseClient';

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

/**
 * Phase 1 Stores service. Every method is a server-authoritative RPC; the
 * browser never writes requisitions, issue notes, cost centres or stock.
 */
export const storesService = {
  getSettings(propertyId) {
    return rpc('fn_stores_get_settings', { p_property_id: propertyId });
  },

  updateSettings(propertyId, payload) {
    return rpc('fn_stores_update_settings', {
      p_property_id: propertyId,
      p_payload: payload,
    });
  },

  listCostCentres(propertyId) {
    return rpc('fn_stores_list_cost_centres', { p_property_id: propertyId });
  },

  listLocations(propertyId) {
    return rpc('fn_stores_list_locations', { p_property_id: propertyId });
  },

  upsertCostCentre(propertyId, payload) {
    return rpc('fn_stores_upsert_cost_centre', {
      p_property_id: propertyId,
      p_payload: payload,
    });
  },

  listParTemplates(propertyId, costCentreId = null) {
    return rpc('fn_stores_list_par_templates', {
      p_property_id: propertyId,
      p_cost_centre_id: costCentreId,
    });
  },

  saveParTemplate(propertyId, payload) {
    return rpc('fn_stores_save_par_template', {
      p_property_id: propertyId,
      p_payload: payload,
    });
  },

  archiveParTemplate(propertyId, templateId) {
    return rpc('fn_stores_archive_par_template', {
      p_property_id: propertyId,
      p_template_id: templateId,
    });
  },

  listRequisitions(propertyId, { status = null, costCentreId = null, search = null, limit = 50, offset = 0 } = {}) {
    return rpc('fn_stores_list_requisitions', {
      p_property_id: propertyId,
      p_status: status,
      p_cost_centre_id: costCentreId,
      p_search: search,
      p_limit: limit,
      p_offset: offset,
    });
  },

  requisitionDetail(propertyId, requisitionId) {
    return rpc('fn_stores_requisition_detail', {
      p_property_id: propertyId,
      p_requisition_id: requisitionId,
    });
  },

  saveRequisition(propertyId, payload) {
    return rpc('fn_stores_save_requisition', {
      p_property_id: propertyId,
      p_payload: payload,
    });
  },

  submitRequisition(propertyId, requisitionId) {
    return rpc('fn_stores_submit_requisition', {
      p_property_id: propertyId,
      p_requisition_id: requisitionId,
    });
  },

  decideRequisition(propertyId, requisitionId, decision, { reason = null, lines = null } = {}) {
    return rpc('fn_stores_decide_requisition', {
      p_property_id: propertyId,
      p_requisition_id: requisitionId,
      p_decision: decision,
      p_reason: reason,
      p_lines: lines,
    });
  },

  cancelRequisition(propertyId, requisitionId, reason) {
    return rpc('fn_stores_cancel_requisition', {
      p_property_id: propertyId,
      p_requisition_id: requisitionId,
      p_reason: reason,
    });
  },

  requisitionProducts(propertyId, costCentreId = null) {
    return rpc('fn_stores_requisition_products', {
      p_property_id: propertyId,
      p_cost_centre_id: costCentreId,
    });
  },

  issueRequisition(propertyId, payload) {
    return rpc('fn_stores_issue_requisition', {
      p_property_id: propertyId,
      p_payload: payload,
    });
  },

  directIssue(propertyId, payload) {
    return rpc('fn_stores_direct_issue', {
      p_property_id: propertyId,
      p_payload: payload,
    });
  },

  confirmIssueReceipt(propertyId, issueNoteId, { lines = null, notes = null } = {}) {
    return rpc('fn_stores_confirm_issue_receipt', {
      p_property_id: propertyId,
      p_issue_note_id: issueNoteId,
      p_lines: lines,
      p_notes: notes,
    });
  },

  voidIssue(propertyId, issueNoteId, reason) {
    return rpc('fn_stores_void_issue', {
      p_property_id: propertyId,
      p_issue_note_id: issueNoteId,
      p_reason: reason,
    });
  },

  listIssueNotes(propertyId, { status = null, costCentreId = null, search = null, limit = 50, offset = 0 } = {}) {
    return rpc('fn_stores_list_issue_notes', {
      p_property_id: propertyId,
      p_status: status,
      p_cost_centre_id: costCentreId,
      p_search: search,
      p_limit: limit,
      p_offset: offset,
    });
  },

  issueNoteDetail(propertyId, issueNoteId) {
    return rpc('fn_stores_issue_note_detail', {
      p_property_id: propertyId,
      p_issue_note_id: issueNoteId,
    });
  },

  // Phase 2: in-transit stock transfers. Every method is a guarded RPC; the
  // browser never writes transfer rows, stock or ledger entries directly.
  listTransfers(propertyId, { status = null, search = null, overdueOnly = false, limit = 50, offset = 0 } = {}) {
    return rpc('fn_stores_list_transfers', {
      p_property_id: propertyId,
      p_status: status,
      p_search: search,
      p_overdue_only: overdueOnly,
      p_limit: limit,
      p_offset: offset,
    });
  },

  transferDetail(propertyId, transferId) {
    return rpc('fn_stores_transfer_detail', {
      p_property_id: propertyId,
      p_transfer_id: transferId,
    });
  },

  transferProducts(propertyId, locationId = null) {
    return rpc('fn_stores_transfer_products', {
      p_property_id: propertyId,
      p_location_id: locationId,
    });
  },

  createTransfer(propertyId, payload) {
    return rpc('fn_stores_create_transfer', {
      p_property_id: propertyId,
      p_payload: payload,
    });
  },

  dispatchTransfer(propertyId, transferId) {
    return rpc('fn_stores_dispatch_transfer', {
      p_property_id: propertyId,
      p_transfer_id: transferId,
    });
  },

  receiveTransfer(propertyId, transferId, payload = {}) {
    return rpc('fn_stores_receive_transfer', {
      p_property_id: propertyId,
      p_transfer_id: transferId,
      p_payload: payload,
    });
  },

  cancelTransfer(propertyId, transferId, reason) {
    return rpc('fn_stores_cancel_transfer', {
      p_property_id: propertyId,
      p_transfer_id: transferId,
      p_reason: reason,
    });
  },

  markTransfersOverdue(propertyId) {
    return rpc('fn_stores_mark_transfers_overdue', { p_property_id: propertyId });
  },

  dashboard(propertyId) {
    return rpc('fn_stores_dashboard', { p_property_id: propertyId });
  },

  listNotifications(propertyId, { unreadOnly = false, limit = 50 } = {}) {
    return rpc('fn_stores_list_notifications', {
      p_property_id: propertyId,
      p_unread_only: unreadOnly,
      p_limit: limit,
    });
  },

  markNotificationsRead(propertyId, ids = null) {
    return rpc('fn_stores_mark_notifications_read', {
      p_property_id: propertyId,
      p_ids: ids,
    });
  },
};

export default storesService;
