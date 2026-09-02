// Platform authentication service — Supabase-backed.
//
// This replaces the previous localStorage-only implementation. The public
// interface (getCurrentUser/register/login/logout/requestPasswordReset/
// resetPassword) is kept identical on purpose so AuthContext.jsx and every
// page that calls it (Login, Register, ForgotPassword, ResetPassword)
// needed no changes.
//
// Real security now lives server-side: Supabase Auth verifies passwords
// and issues sessions; Postgres RLS (see supabase/migrations) decides what
// each authenticated user can read/write. This file is just a thin,
// UI-friendly wrapper around that.

import { supabase } from '@/lib/supabaseClient';

export const STAFF_ROLES = [
  'super_admin','hotel_admin','front_office_manager','receptionist','front_desk',
  'pos_staff','waiter','cashier','store_manager','fb_manager','housekeeping_supervisor',
];
export const MODULE_NAMES = ['pos','backoffice','store'];
export const ROLE_LABELS = {
  super_admin: 'Super Admin / Owner', hotel_admin: 'Hotel Admin', front_office_manager: 'Front Office Manager',
  receptionist: 'Receptionist', front_desk: 'Front Desk', pos_staff: 'POS Staff', waiter: 'Waiter', cashier: 'Cashier',
  store_manager: 'Store Manager', fb_manager: 'F&B Manager', housekeeping_supervisor: 'Housekeeping Supervisor',
};
export function normalizeStaffRole(role) {
  const value = String(role || '').toLowerCase().trim().replace(/\s+/g, '_');
  const aliases = { owner:'hotel_admin', administrator:'hotel_admin', general_manager:'hotel_admin', manager:'front_office_manager', storekeeper:'store_manager', housekeeping:'housekeeping_supervisor' };
  return aliases[value] || value;
}
export function getDefaultModulesForRole(role) {
  switch (normalizeStaffRole(role)) {
    case 'super_admin': case 'hotel_admin': return [...MODULE_NAMES];
    case 'front_office_manager': return ['backoffice','store'];
    case 'receptionist': case 'front_desk': return ['backoffice'];
    case 'pos_staff': case 'waiter': case 'cashier': return ['pos'];
    case 'store_manager': return ['store'];
    case 'fb_manager': return ['pos','store'];
    case 'housekeeping_supervisor': return ['backoffice','store'];
    default: return [];
  }
}
export function generatePin(length = 4) {
  const digits = [];
  const bytes = new Uint32Array(length);
  globalThis.crypto?.getRandomValues?.(bytes);
  for (let i = 0; i < length; i += 1) digits.push(String((bytes[i] || Math.floor(Math.random() * 10)) % 10));
  if (digits[0] === '0') digits[0] = '1';
  return digits.join('');
}
export function getSessionStaff() {
  try { return JSON.parse(sessionStorage.getItem('olitech_active_staff_v2') || 'null'); } catch { return null; }
}
export async function hashPin(pin) {
  const value = String(pin || '');
  if (!/^\d{4,6}$/.test(value)) throw new Error('PIN must contain 4 to 6 digits.');
  if (!globalThis.crypto?.subtle) throw new Error('Secure PIN hashing is not available in this browser.');
  const bytes = new TextEncoder().encode(`OliTechs::PIN::${value}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2,'0')).join('');
}

function toAppUser({ profile, property, propertyRole, staff = null }) {
	if (!profile) return null;
	return {
		id: profile.id,
		name: profile.full_name || profile.email,
		email: profile.email,
		// Kept for backward compatibility with existing UI that reads
		// `user.role` as a simple display label.
		role: profile.platform_role === 'platform_owner' ? 'Platform Owner' : propertyRole === 'owner' ? 'Administrator' : 'Staff',
		platformRole: profile.platform_role,
		isPlatformOwner: profile.platform_role === 'platform_owner',
		property: property || null,
		propertyRole: propertyRole || null,
		staff,
	};
}

// Property applications are created server-side by the auth trigger.
// The authenticated safety-net below also repairs older accounts and makes
// the registration flow idempotent without weakening RLS.

async function loadCurrentUserDetails() {
	const { data: authData } = await supabase.auth.getUser();
	const authUser = authData?.user;
	if (!authUser) return null;

	const { data: profile, error: profileError } = await supabase
		.from('profiles')
		.select('*')
		.eq('id', authUser.id)
		.single();
	if (profileError || !profile) return null;

	// Platform owners aren't necessarily tied to a property.
	if (profile.platform_role === 'platform_owner') {
		return toAppUser({ profile, property: null, propertyRole: null });
	}

	// Ensure every regular signed-in registrant has a real property application.
	// This is an idempotent safety net for older accounts and deployments where
	// the signup trigger was not installed when the account was created.
	const { error: ensureError } = await supabase.rpc('ensure_my_pending_property', {
		p_business_name: authUser.user_metadata?.pending_business_name || null,
	});
	if (ensureError) {
		console.error('[authService] ensure_my_pending_property failed:', ensureError.message);
	}
	// A regular user's primary property — a person can technically belong
	// to more than one property later, but the login/onboarding flow only
	// needs "their" property today.
	const { data: membership } = await supabase
		.from('property_users')
		.select('role, property:properties(*)')
		.eq('user_id', authUser.id)
		.limit(1)
		.maybeSingle();
	const propertyId = membership?.property?.id;
	let staff = null;
	if (propertyId) {
		const { data: staffRow } = await supabase.from('staff').select('id,full_name,email,phone,role,assigned_modules,is_active,property_id,avatar,last_login,user_id').eq('property_id', propertyId).ilike('email', authUser.email || '').maybeSingle();
		staff = staffRow || null;
	}

	return toAppUser({
		profile,
		property: membership?.property || null,
		propertyRole: membership?.role || null,
		staff,
	});
}

export const authService = {
	async getCurrentUser() {
		try {
			return await loadCurrentUserDetails();
		} catch {
			return null;
		}
	},

	// Registers a NEW property application, per spec section 19-20:
	// account is created, a property is created in `pending` / `none`
	// package status, and the caller is added as that property's `owner`.
	// This does NOT grant PMS/POS access — the onboarding screen handles
	// showing the pending state until the platform owner approves.
	//
	// Returns either:
	//   { needsEmailConfirmation: true }              — no session yet;
	//     the property application has already been created server-side; the owner
	//     simply confirms their email and signs in to see its pending status.
	//   the app user object                            — session existed
	//     immediately (confirmation disabled/auto-confirmed project), so
	//     the property was created right away, same as before.
	async register({ name, email, password, businessName }) {
		if (!name || !email || !password) {
			throw new Error('Name, email and password are required.');
		}
		const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
			email: email.trim().toLowerCase(),
			password,
			options: {
				data: {
					full_name: name,
					// These metadata fields are consumed by the server-side auth trigger
					// so the pending application exists even when email confirmation
					// means this signUp call returns without a session.
					pending_owner_signup: true,
					pending_business_name: businessName || null,
				},
			},
		});
		if (signUpError) throw new Error(signUpError.message);

		const authUser = signUpData?.user;
		if (!authUser) {
			throw new Error('Could not create your account. Please try again.');
		}

		if (!signUpData.session) {
			// Email confirmation is required before a session exists. The
			// server-side auth trigger has already created the pending property,
			// so there is nothing to insert from this anonymous browser request.
			return { needsEmailConfirmation: true, email: authUser.email };
		}

		// We already have a session (confirmation is off, or this Supabase
		// project auto-confirms new users). The trigger should already have created
		// the application; this idempotent safety-net repairs partially deployed
		// databases without weakening RLS.
		const { error: ensureError } = await supabase.rpc('ensure_my_pending_property', {
			p_business_name: businessName || null,
		});
		if (ensureError) {
			console.error('[authService] ensure_my_pending_property failed:', ensureError.message);
			throw new Error(
				"Your account was created, but the property application could not be completed. Apply migration 0011_fix_property_registration_rls.sql in Supabase, then sign in again."
			);
		}

		return loadCurrentUserDetails();
	},

	async login({ email, password }) {
		if (!email || !password) {
			throw new Error('Email and password are required.');
		}
		const { error } = await supabase.auth.signInWithPassword({
			email: email.trim().toLowerCase(),
			password,
		});
		if (error) throw new Error(error.message);
		return loadCurrentUserDetails();
	},

	async logout() {
		try { await supabase.rpc('clear_active_staff_session'); } catch { /* migration may not be applied yet */ }
		await supabase.auth.signOut();
	},
	async listStaff(propertyId, module) {
		let query = supabase.from('staff').select('id,full_name,email,phone,role,assigned_modules,is_active,property_id,avatar,last_login,user_id').eq('property_id', propertyId).eq('is_active', true).order('full_name');
		const { data, error } = await query;
		if (error) throw new Error(error.message);
		const rows = data || [];
		return module ? rows.filter((row) => Array.isArray(row.assigned_modules) && row.assigned_modules.includes(module)) : rows;
	},

	async listAllStaff(propertyId) {
		const { data, error } = await supabase.from('staff').select('id,full_name,email,phone,role,assigned_modules,is_active,property_id,avatar,last_login,user_id,created_at').eq('property_id', propertyId).order('full_name');
		if (error) throw new Error(error.message); return data || [];
	},

	async createStaff({ propertyId, fullName, email, phone, role, assignedModules, pin, avatar, userId }) {
		const pinHash = await hashPin(pin);
		const { data, error } = await supabase.rpc('create_staff_member', { p_property_id: propertyId, p_full_name: fullName, p_email: email || null, p_phone: phone || null, p_role: role, p_assigned_modules: assignedModules || getDefaultModulesForRole(role), p_pin_hash: pinHash, p_avatar: avatar || null, p_user_id: userId || null });
		if (error) throw new Error(error.message); return data;
	},

	async updateStaff(id, patch) {
		const safe = { ...patch }; delete safe.pin; delete safe.pin_hash;
		const { data, error } = await supabase.from('staff').update(safe).eq('id', id).select('id,full_name,email,phone,role,assigned_modules,is_active,property_id,avatar,last_login,user_id,created_at').single();
		if (error) throw new Error(error.message); return data;
	},

	async resetStaffPin(id, pin) {
		const pinHash = await hashPin(pin);
		const { error } = await supabase.rpc('reset_staff_pin', { p_staff_id: id, p_pin_hash: pinHash });
		if (error) throw new Error(error.message); return true;
	},

	async listStaffLogs(propertyId) {
		const { data, error } = await supabase.from('staff_logs').select('id,staff_id,staff_name,module,action,created_at').eq('property_id', propertyId).order('created_at', { ascending: false }).limit(200);
		if (error) throw new Error(error.message); return data || [];
	},

	async deleteStaff(id) {
		const { error } = await supabase.from('staff').delete().eq('id', id);
		if (error) throw new Error(error.message); return true;
	},

	async touchActiveStaffSession() {
		const { error } = await supabase.rpc('touch_active_staff_session');
		if (error) throw new Error(error.message);
	},

	async verifyStaffPin({ propertyId, module, pin }) {
		const pinHash = await hashPin(pin);
		const { data, error } = await supabase.rpc('verify_staff_pin', { p_property_id: propertyId, p_module: module, p_pin_hash: pinHash });
		if (error) throw new Error(error.message); return data || { ok: false };
	},


	async requestPasswordReset({ email }) {
		const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined;
		await supabase.auth.resetPasswordForEmail((email || '').trim().toLowerCase(), { redirectTo });
		// Always resolve successfully — don't reveal whether the email exists.
		return { sent: true };
	},

	async resetPassword({ newPassword }) {
		if (!newPassword) throw new Error('New password is required.');
		const { error } = await supabase.auth.updateUser({ password: newPassword });
		if (error) throw new Error(error.message);
		return { ok: true };
	},
};
