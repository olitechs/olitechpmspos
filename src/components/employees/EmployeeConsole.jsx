// Employee Management console — Back Office.
//
// Permission-gated by the server-resolved summary (back_office.employees.manage;
// licences additionally by back_office.billing.manage). Property owners and
// administrators implicitly hold every permission, so the console behaves the
// same as before for them. Scoped employees without the code see an access
// denied state — the server would reject every mutation anyway.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, RefreshCw, ShieldAlert, Users } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { hasPermissionCode } from '@/services/authService';
import { employeeService } from '@/services/employeeService';
import DepartmentsPanel from '@/components/employees/DepartmentsPanel';
import RolesPermissionsPanel from '@/components/employees/RolesPermissionsPanel';
import InvitationsPanel from '@/components/employees/InvitationsPanel';
import ManagerCredentialsPanel from '@/components/employees/ManagerCredentialsPanel';
import AccessHistoryPanel from '@/components/employees/AccessHistoryPanel';
import LicencesPanel from '@/components/employees/LicencesPanel';
import EmployeesPanel from '@/components/employees/EmployeesPanel';

const TABS = [
  { id: 'employees', label: 'Employees', path: '/backoffice/employees/manage', permission: 'back_office.employees.manage' },
  { id: 'departments', label: 'Departments', path: '/backoffice/employees/departments', permission: 'back_office.employees.manage' },
  { id: 'permissions', label: 'Roles & permissions', path: '/backoffice/employees/roles', permission: 'back_office.employees.manage' },
  { id: 'invitations', label: 'Invitations', path: '/backoffice/employees/invitations', permission: 'back_office.employees.manage' },
  { id: 'security', label: 'PIN & security', path: '/backoffice/employees/security', permission: 'back_office.employees.manage' },
  { id: 'history', label: 'Access history', path: '/backoffice/employees/access-history', permission: 'back_office.employees.manage' },
  { id: 'licences', label: 'Employee licences', path: '/backoffice/employees/licences', permission: 'back_office.billing.manage' },
];

const INTRO = {
  employees: ['Employee management', 'Register employees, assign departments and permission bundles, and manage account status. Every change is licence-aware and audited.'],
  departments: ['Departments', 'Group employees by department. Each department defaults to one workspace, which drives which screens its employees can reach.'],
  permissions: ['Roles & permissions', 'Create custom permission bundles from the server-side catalog. The browser never defines permission codes — they are validated against the catalog in Postgres.'],
  invitations: ['Invitations', 'Invite employees by email. They create their own password through a one-time link; the invitation token is bcrypt-hashed at rest and shown to you only once.'],
  security: ['PIN & security', 'Manager authorization PINs are hashed server-side (bcrypt) and used by the full-screen manager approval. Existing staff PINs keep their current behavior.'],
  history: ['Access history', 'Every permission check, manager approval, rejection and licence event for this property.'],
  licences: ['Employee licences', 'Your plan includes a set number of employee seats. Additional seats are billed monthly at the platform-configured price.'],
};

export default function EmployeeConsole({ tab = 'employees' }) {
  const { user } = useAuth();
  const propertyId = user?.property?.id;
  const activeTab = TABS.some((t) => t.id === tab) ? tab : 'employees';
  const permission = TABS.find((t) => t.id === activeTab)?.permission;
  const allowed = hasPermissionCode(user, permission);
  const [title, description] = INTRO[activeTab];
  const [licenceState, setLicenceState] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!propertyId || !allowed) return;
    let cancelled = false;
    employeeService.licenceState(propertyId)
      .then((state) => { if (!cancelled) setLicenceState(state); })
      .catch(() => { /* licence overview is informational only */ });
    return () => { cancelled = true; };
  }, [propertyId, allowed, reloadKey]);

  const licenceBanner = useMemo(() => {
    if (!licenceState) return null;
    const over = Number(licenceState.over_limit || 0) > 0;
    const seats = `${Number(licenceState.registered_employees || 0) + Number(licenceState.pending_invitations || 0)} / ${Number(licenceState.included_employees || 0) + Number(licenceState.additional_employees || 0)}`;
    return (
      <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${over ? 'border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger-text)]' : 'border-[var(--border)] bg-[var(--canvas)] text-[var(--text)]'}`}>
        <Users size={15} aria-hidden="true" />
        <span><b>{seats}</b> employee seats in use</span>
        <span className="text-[var(--text-muted)]">
          ({licenceState.included_employees} included{Number(licenceState.additional_employees || 0) > 0 ? ` + ${licenceState.additional_employees} additional` : ''})
        </span>
        {over && <span className="font-semibold">— over the plan allowance; deactivate employees or add licences.</span>}
      </div>
    );
  }, [licenceState]);

  if (!allowed) {
    return (
      <div className="min-h-full bg-secondary p-4 md:p-6">
        <div className="mx-auto max-w-2xl rounded-2xl border bg-surface p-8 text-center">
          <ShieldAlert size={32} className="mx-auto text-[var(--danger)]" aria-hidden="true" />
          <h1 className="mt-3 text-xl font-black text-[var(--text)]">Access denied</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Your account does not hold the “{TABS.find((t) => t.id === activeTab)?.label}” permission. Ask an administrator, or request a manager authorization with the <b>back_office.employees.manage</b> permission.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-secondary p-4 md:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Back Office</div>
            <h1 className="text-2xl font-black text-[var(--text)]">{title}</h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--text-muted)]">{description}</p>
          </div>
          <button type="button" onClick={reload} className="rounded-xl border border-[var(--border)] bg-surface p-2.5 text-[var(--text)] hover:bg-[var(--primary-soft)]" aria-label="Refresh" title="Refresh">
            <RefreshCw size={17} />
          </button>
        </div>

        {activeTab !== 'licences' && licenceBanner}

        <div className="mt-4">
          {activeTab === 'employees' && <EmployeesPanel propertyId={propertyId} reloadKey={reloadKey} licenceState={licenceState} onLicenceRefused={reload} />}
          {activeTab === 'departments' && <DepartmentsPanel propertyId={propertyId} reloadKey={reloadKey} />}
          {activeTab === 'permissions' && <RolesPermissionsPanel propertyId={propertyId} reloadKey={reloadKey} />}
          {activeTab === 'invitations' && <InvitationsPanel propertyId={propertyId} reloadKey={reloadKey} />}
          {activeTab === 'security' && <ManagerCredentialsPanel propertyId={propertyId} reloadKey={reloadKey} />}
          {activeTab === 'history' && <AccessHistoryPanel propertyId={propertyId} reloadKey={reloadKey} />}
          {activeTab === 'licences' && <LicencesPanel propertyId={propertyId} reloadKey={reloadKey} onReload={reload} />}
        </div>

        <div className="mt-6 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
          <Building2 size={13} aria-hidden="true" />
          All actions here are recorded in the access history and the property audit log.
        </div>
      </div>
    </div>
  );
}
