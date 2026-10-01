// Platform-owner operations: property review/approval, package assignment,
// dashboard stats, audit log. Every write here is also re-checked by
// Postgres RLS (see supabase/migrations/0001_platform_admin.sql) — a
// non-owner calling these functions directly will simply have their
// request rejected by the database, not just blocked by this file.

import { supabase } from '@/lib/supabaseClient';

async function logAudit({ action, propertyId, oldValue, newValue }) {
	const { data: authData } = await supabase.auth.getUser();
	const actorId = authData?.user?.id;
	if (!actorId) return;
	await supabase.from('audit_logs').insert({
		actor_id: actorId,
		action,
		property_id: propertyId || null,
		old_value: oldValue ?? null,
		new_value: newValue ?? null,
	});
}

export const platformService = {
	async listProperties() {
		const { data, error } = await supabase.rpc('admin_list_properties');
		if (error) throw new Error(error.message);
		return data || [];
	},

	async getProperty(id) {
		const { data, error } = await supabase.from('properties').select('*').eq('id', id).single();
		if (error) throw new Error(error.message);
		return data;
	},

	async getPropertyUsers(propertyId) {
		const { data, error } = await supabase.rpc('admin_property_users', { p_property_id: propertyId });
		if (error) throw new Error(error.message);
		return data || [];
	},

	async setStatus(propertyId, status, previousStatus) {
		const { error } = await supabase.from('properties').update({ status }).eq('id', propertyId);
		if (error) throw new Error(error.message);
		await logAudit({
			action: `property_status_changed`,
			propertyId,
			oldValue: { status: previousStatus },
			newValue: { status },
		});
	},

	async setPackage(propertyId, pkg, previousPackage) {
		const { error } = await supabase.from('properties').update({ package: pkg }).eq('id', propertyId);
		if (error) throw new Error(error.message);
		await logAudit({
			action: `property_package_changed`,
			propertyId,
			oldValue: { package: previousPackage },
			newValue: { package: pkg },
		});
	},

	async approve(propertyId, pkg) {
		const { error } = await supabase.rpc('approve_property', {
			p_property_id: propertyId,
			p_package: pkg,
		});
		if (error) throw new Error(error.message);
	},

	async listAuditLog(propertyId) {
		const { data, error } = await supabase.rpc('admin_audit_log', { p_property_id: propertyId || null });
		if (error) throw new Error(error.message);
		return data || [];
	},

	// Build dashboard figures from the same admin_list_properties RPC that
	// powers the working Properties screen. This keeps the dashboard from
	// failing when PostgREST has not exposed the optional aggregate RPC in
	// its schema cache.
	buildDashboardStats(properties = []) {
		const rows = Array.isArray(properties) ? properties : [];
		const uniqueOwners = new Set(rows.map((p) => p.owner_email).filter(Boolean));
		return {
			totalProperties: rows.length,
			pendingProperties: rows.filter((p) => p.status === 'pending').length,
			activeProperties: rows.filter((p) => p.status === 'active').length,
			suspendedProperties: rows.filter((p) => p.status === 'suspended').length,
			activeUsers: uniqueOwners.size,
			activePackages: {
				standard: rows.filter((p) => p.status === 'active' && p.package === 'standard').length,
				premium: rows.filter((p) => p.status === 'active' && p.package === 'premium').length,
				professional: rows.filter((p) => p.status === 'active' && p.package === 'professional').length,
				none: rows.filter((p) => p.package === 'none').length,
			},
		};
	},

	// Kept for compatibility with older callers. The dashboard itself no
	// longer depends on this aggregate RPC.
	async getDashboardStats() {
		const properties = await this.listProperties();
		return this.buildDashboardStats(properties);
	},

	async findUserByEmail(email) {
		const { data, error } = await supabase.rpc('platform_find_user_by_email', { p_email: email.trim() });
		if (error) throw new Error(error.message);
		return Array.isArray(data) ? data[0] || null : data || null;
	},

	async updateProperty(input) {
		const { data, error } = await supabase.rpc('platform_update_property', {
			p_property_id: input.id,
			p_name: input.name,
			p_business_name: input.business_name || null,
			p_property_type: input.property_type || null,
			p_address: input.address || null,
			p_country: input.country || null,
			p_city: input.city || null,
			p_phone: input.phone || null,
			p_email: input.email || null,
			p_website: input.website || null,
			p_currency: input.currency || 'USD',
			p_timezone: input.timezone || 'UTC',
			p_business_registration: input.business_registration || null,
			p_contact_person: input.contact_person || null,
		});
		if (error) throw new Error(error.message);
		return data;
	},

	async setStatusManaged(propertyId, status) {
		const { data, error } = await supabase.rpc('platform_set_property_status', { p_property_id: propertyId, p_status: status });
		if (error) throw new Error(error.message);
		return data;
	},

	async setPackageManaged(propertyId, pkg) {
		const { data, error } = await supabase.rpc('platform_set_property_package', { p_property_id: propertyId, p_package: pkg });
		if (error) throw new Error(error.message);
		return data;
	},

	async assignOwner(propertyId, userId) {
		const { data, error } = await supabase.rpc('platform_assign_property_owner', { p_property_id: propertyId, p_owner_user_id: userId });
		if (error) throw new Error(error.message);
		return data;
	},

	async listPropertyMembers(propertyId) {
		const { data, error } = await supabase.rpc('platform_list_property_members', { p_property_id: propertyId });
		if (error) throw new Error(error.message);
		return data || [];
	},

	async setPropertyMember(propertyId, userId, role) {
		const { data, error } = await supabase.rpc('platform_set_property_member', { p_property_id: propertyId, p_user_id: userId, p_role: role });
		if (error) throw new Error(error.message);
		return data;
	},

	async removePropertyMember(propertyId, userId) {
		const { data, error } = await supabase.rpc('platform_remove_property_member', { p_property_id: propertyId, p_user_id: userId });
		if (error) throw new Error(error.message);
		return data;
	},

	async updateSubscription(input) {
		const { data, error } = await supabase.rpc('platform_update_subscription', {
			p_property_id: input.propertyId,
			p_plan_code: input.planCode,
			p_status: input.status,
			p_trial_ends_at: input.trialEndsAt || null,
			p_current_period_ends_at: input.currentPeriodEndsAt || null,
			p_grace_ends_at: input.graceEndsAt || null,
			p_enabled_modules: input.enabledModules || [],
		});
		if (error) throw new Error(error.message);
		return data;
	},

	async getSubscription(propertyId) {
		const { data, error } = await supabase.rpc('fn_get_subscription', { p_property_id: propertyId });
		if (error) throw new Error(error.message);
		return data;
	},

	async createProperty(input) {
		const { data, error } = await supabase.rpc('platform_create_property', {
			p_name: input.name,
			p_business_name: input.business_name || null,
			p_property_type: input.property_type || null,
			p_address: input.address || null,
			p_country: input.country || null,
			p_city: input.city || null,
			p_phone: input.phone || null,
			p_email: input.email || null,
			p_website: input.website || null,
			p_currency: input.currency || 'USD',
			p_timezone: input.timezone || 'UTC',
			p_business_registration: input.business_registration || null,
			p_contact_person: input.contact_person || null,
			p_status: input.status || 'active',
			p_package: input.package || 'standard',
			p_owner_user_id: input.ownerUserId || null,
		});
		if (error) throw new Error(error.message);
		return data;
	},

};
