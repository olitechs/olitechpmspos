import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer, ReceiptText, FileText, ChevronRight, ShieldCheck } from 'lucide-react';

const ITEMS = [
  {
    path: '/admin/settings/printers',
    icon: Printer,
    title: 'Printer Settings',
    description: 'Configure receipt, kitchen and bar printers, connections and assignment routing.',
  },
  {
    path: '/admin/settings/receipt',
    icon: ReceiptText,
    title: 'Receipt Settings',
    description: 'Configure company identity, logo, header, footer and receipt presentation.',
  },
  {
    path: '/admin/settings/unsettled-receipt',
    icon: FileText,
    title: 'Unsettled Receipt Settings',
    description: 'Control the open-bill receipt title, duplicate copies and front-office copy behavior.',
  },
];

export default function PropertyAdminSettings() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-[#090C11] p-3 text-[#FFD300]"><ShieldCheck size={20} /></div>
          <div>
            <h1 className="text-2xl font-black text-foreground">Property Settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">Manage the operational settings available to your property administrator.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ITEMS.map(({ path, icon: Icon, title, description }) => (
          <button
            key={path}
            type="button"
            onClick={() => navigate(path)}
            className="group rounded-2xl border border-border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="rounded-xl bg-[#FFF7D6] p-3 text-[#090C11]">
                <Icon size={20} />
              </div>
              <ChevronRight size={18} className="text-muted-foreground transition-transform group-hover:translate-x-1" />
            </div>
            <h2 className="mt-5 text-base font-black text-foreground">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
            <span className="mt-4 inline-flex rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-bold text-foreground">Open settings</span>
          </button>
        ))}
      </div>
    </div>
  );
}
