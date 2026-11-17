// Employee management service — departments, custom roles, invitations,
// manager authorization and employee licensing.
//
// Every call goes through a Postgres security-definer RPC; nothing here
// writes permission lists, licence counts or manager credentials directly.
// The server re-validates every input (see
// supabase/migrations/20261117105534_phase1_employee_management_licensing.sql).

import { supabase } from '@/lib/supabaseClient';

function rpcError(error) {
  // Licence refusals carry the licence state in the exception detail so the
  // UI can render the licence limit screen without a second round trip.
  const raw = String(error?.message || 'Request failed.');
  if (raw.startsWith('licence_limit_reached')) {
    const detail = String(error?.details || '');
    let state = null;
    try { state = JSON.parse(detail); } catch { /* detail is best-effort */ }
    const err = new Error('Employee licence limit reached.');
    err.code = 'licence_limit_reached';
    err.licenceState = state;
    throw err;
  }
  throw new Error(raw);
}

async function callRpc(fnName, params) {
  const { data, error } = await supabase.rpc(fnName, params);
  if (error) return void rpcError(error);
  return data;
}

export const employeeService = {
  // -- Departments ----------------------------------------------------------
  listDepartments(propertyId) {
    return callRpc('fn_list_employee_departments', { p_property_id: propertyId });
  },
  createDepartment(propertyId, name, defaultWorkspace, description = null) {
    return callRpc('fn_create_employee_department', {
      p_property_id: propertyId, p_name: name, p_default_workspace: defaultWorkspace, p_description: description,
    });
  },
  updateDepartment(departmentId, name, defaultWorkspace, description = null) {
    return callRpc('fn_update_employee_department', {
      p_department_id: departmentId, p_name: name, p_default_workspace: defaultWorkspace, p_description: description,
    });
  },
  deleteDepartment(departmentId) {
    return callRpc('fn_delete_employee_department', { p_department_id: departmentId });
  },

  // -- Custom roles & permissions ------------------------------------------
  listRoles(propertyId) {
    return callRpc('fn_list_employee_roles', { p_property_id: propertyId });
  },
  createRole(propertyId, name, workspace, permissionCodes, description = null) {
    return callRpc('fn_create_employee_role', {
      p_property_id: propertyId, p_name: name, p_workspace: workspace,
      p_permission_codes: permissionCodes, p_description: description,
    });
  },
  updateRole(roleId, name, workspace, permissionCodes, description = null) {
    return callRpc('fn_update_employee_role', {
      p_role_id: roleId, p_name: name, p_workspace: workspace,
      p_permission_codes: permissionCodes, p_description: description,
    });
  },
  deleteRole(roleId) {
    return callRpc('fn_delete_employee_role', { p_role_id: roleId });
  },

  // -- Employee CRUD (licence-aware; supersedes create_staff_member) --------
  createEmployee({ propertyId, fullName, email, phone, staffRole, assignedModules, pinHash, roleId, departmentId, avatar }) {
    return callRpc('fn_create_employee_with_licence', {
      p_property_id: propertyId, p_full_name: fullName, p_email: email || null, p_phone: phone || null,
      p_staff_role: staffRole, p_assigned_modules: assignedModules || [], p_pin_hash: pinHash,
      p_role_id: roleId || null, p_department_id: departmentId || null, p_avatar: avatar || null,
    });
  },
  setModules(staffId, modules) {
    return callRpc('fn_set_employee_modules', { p_staff_id: staffId, p_modules: modules || [] });
  },
  setDepartment(staffId, departmentId) {
    return callRpc('fn_set_employee_department', { p_staff_id: staffId, p_department_id: departmentId });
  },
  setRole(staffId, roleId) {
    return callRpc('fn_set_employee_role', { p_staff_id: staffId, p_role_id: roleId });
  },
  // status: 'active' | 'inactive' | 'suspended'
  setStatus(staffId, status) {
    const p_active = status === 'active';
    return callRpc('fn_set_employee_status', { p_staff_id: staffId, p_active, p_suspended: status === 'suspended' });
  },

  // -- Invitations ----------------------------------------------------------
  listInvitations(propertyId) {
    return callRpc('fn_list_employee_invitations', { p_property_id: propertyId });
  },
  listInvitationEmailDelivery(propertyId) {
    return callRpc('fn_list_employee_email_delivery', { p_property_id: propertyId });
  },
  createInvitation({ propertyId, email, fullName, staffRole, assignedModules, roleId, departmentId }) {
    return callRpc('fn_create_employee_invitation', {
      p_property_id: propertyId, p_email: email, p_full_name: fullName,
      p_staff_role: staffRole, p_assigned_modules: assignedModules || [],
      p_role_id: roleId || null, p_department_id: departmentId || null,
    });
  },
  resendInvitation(invitationId) {
    return callRpc('fn_resend_employee_invitation', { p_invitation_id: invitationId });
  },
  revokeInvitation(invitationId) {
    return callRpc('fn_revoke_employee_invitation', { p_invitation_id: invitationId });
  },
  acceptInvitation(token) {
    return callRpc('fn_accept_employee_invitation', { p_token: token });
  },

  // Sends (or resends) the invitation email through the employee-invite edge
  // function. Safe to skip when the function is not deployed: the UI offers
  // the claim link for manual sharing in that case.
  async sendInvitationEmail(invitationId, token) {
    const { data, error } = await supabase.functions.invoke('employee-invite', {
      body: { action: 'invite', invitation_id: invitationId, token },
    });
    if (error || !data?.ok) {
      const err = new Error(data?.error || error?.message || 'Invitation email could not be sent.');
      err.code = 'invite_email_failed';
      throw err;
    }
    return data;
  },
  async notifyInvitationAccepted(invitationId) {
    const { data, error } = await supabase.functions.invoke('employee-invite', {
      body: { action: 'accepted', invitation_id: invitationId },
    });
    if (error || !data?.ok) throw new Error(data?.error || error?.message || 'Welcome notification could not be processed.');
    return data;
  },
  async retryEmailNotifications(propertyId) {
    const { data, error } = await supabase.functions.invoke('employee-invite', {
      body: { action: 'retry', property_id: propertyId },
    });
    if (error || !data?.ok) throw new Error(data?.error || error?.message || 'Email notification retry failed.');
    return data;
  },

  // -- Manager authorization ------------------------------------------------
  // PIN path: verified and granted entirely server-side.
  authorizeWithPin(propertyId, permissionCode, pin, durationMinutes = 60, reason = null) {
    return callRpc('fn_verify_manager_authorization', {
      p_property_id: propertyId, p_permission_code: permissionCode,
      p_pin: pin, p_duration_minutes: durationMinutes, p_reason: reason,
    });
  },

  // Password path: the edge function verifies the manager's credentials with
  // Supabase Auth and writes a single-use ticket; the employee's own session
  // then redeems it (fn_redeem_manager_authorization_ticket).
  async authorizeWithPassword(propertyId, permissionCode, { managerEmail, managerPassword }, durationMinutes = 60, reason = null) {
    const { data, error } = await supabase.functions.invoke('manager-authorize', {
      body: {
        property_id: propertyId,
        permission_code: permissionCode,
        manager_email: managerEmail,
        manager_password: managerPassword,
        duration_minutes: durationMinutes,
        reason,
      },
    });
    if (error || !data?.ok) {
      const err = new Error(data?.error || error?.message || 'Manager authorization failed.');
      err.reason = data?.reason || 'failed';
      throw err;
    }
    return callRpc('fn_redeem_manager_authorization_ticket', {
      p_property_id: propertyId, p_ticket_id: data.ticket_id,
      p_duration_minutes: durationMinutes, p_reason: reason,
    });
  },

  revokeGrant(propertyId, grantId) {
    return callRpc('fn_revoke_manager_grant', { p_property_id: propertyId, p_grant_id: grantId });
  },

  // -- Manager credential administration ------------------------------------
  // The PIN itself is bcrypt-hashed server-side by fn_set_manager_pin.
  setManagerPin(propertyId, staffId, pin) {
    return callRpc('fn_set_manager_pin', { p_property_id: propertyId, p_staff_id: staffId, p_pin: pin });
  },
  clearManagerPin(propertyId, staffId) {
    return callRpc('fn_clear_manager_pin', { p_property_id: propertyId, p_staff_id: staffId });
  },

  // -- Permission summary (loaded at login by authService) -------------------
  permissionSummary(propertyId) {
    return callRpc('fn_employee_permission_summary', { p_property_id: propertyId });
  },

  // -- Licensing ------------------------------------------------------------
  licenceState(propertyId) {
    return callRpc('fn_employee_licence_state', { p_property_id: propertyId });
  },
  activateLicenceAddon(propertyId, quantity) {
    return callRpc('fn_activate_employee_licence_addon', {
      p_property_id: propertyId, p_quantity: quantity, p_request_id: crypto.randomUUID(),
    });
  },
  cancelLicenceAddon(propertyId, addonId) {
    return callRpc('fn_cancel_employee_licence_addon', { p_property_id: propertyId, p_addon_id: addonId });
  },
  listLicenceAddons(propertyId) {
    return supabase.from('employee_licence_addons')
      .select('id,quantity,monthly_price,currency,status,started_at,created_at')
      .eq('property_id', propertyId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return data || [];
      });
  },

  // -- Access audit -----------------------------------------------------------
  // Read directly from the RLS-protected table (property admins only).
  listAccessAudit(propertyId, limit = 100) {
    return supabase.from('employee_access_audit')
      .select('id,staff_id,actor_user_id,action,permission_code,module,result,details,created_at')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .limit(limit)
      .then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return data || [];
      });
  },
};
