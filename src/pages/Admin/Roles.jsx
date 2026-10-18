import { ShieldCheck, UsersRound, LockKeyhole } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

const ROLES = [
  {
    name: 'Owner',
    keys: ['owner'],
    description: 'Property owner with administrative access to property operations.',
  },
  {
    name: 'Admin',
    keys: ['admin'],
    description: 'Property administrator with access to administrative functions.',
  },
  {
    name: 'Manager',
    keys: ['manager'],
    description: 'Property manager with administrative access to operational areas.',
  },
  {
    name: 'Hotel Admin',
    keys: ['hotel_admin'],
    description: 'Hotel administration role used by the staff access layer.',
  },
  {
    name: 'Super Admin',
    keys: ['super_admin'],
    description: 'Elevated hotel administration role used by the staff access layer.',
  },
];

export default function Roles() {
  const { user } = useAuth();

  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <UsersRound className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Staff & Roles</h1>
            <p className="text-sm text-muted-foreground">
              Review the administrative roles recognised by OliTechs PMS + POS.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <h2 className="font-semibold text-foreground">Current account</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {user?.email || 'Signed-in administrator'}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Property role: {user?.propertyRole || 'Not assigned'}
              {user?.staff?.role ? ` · Staff role: ${user.staff.role}` : ''}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {ROLES.map((role) => (
          <article key={role.name} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold text-foreground">{role.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{role.description}</p>
              </div>
              <LockKeyhole className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {role.keys.map((key) => (
                <span
                  key={key}
                  className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                >
                  {key}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
