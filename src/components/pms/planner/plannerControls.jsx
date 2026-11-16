// Shared form controls and modal shell for the PMS room planner. Presentational
// only — state and handlers live in ../RoomPlanner.jsx.
import React from 'react';
import { X } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { NAVY, SURFACE, SURFACE2, BORDER, MUTED } from '@/data/palette';

export function SelectField({ value, onChange, children, className = '' }) { return <Select value={value} onValueChange={onChange} className={className}>{children}</Select>; }
export function InputField({ className = '', ...props }) { return <input {...props} className={`room-planner-input w-full h-10 rounded-lg px-3 text-sm outline-none ${className}`} style={{ background: SURFACE2, border: `1px solid ${BORDER}`, color: NAVY }} />; }
export function Field({ label, children }) { return <label className="block text-xs font-semibold" style={{ color: NAVY }}>{label}<div className="mt-1">{children}</div></label>; }
export function Modal({ title, children, onClose, wide = false }) { return <div className="room-planner-modal-backdrop fixed inset-0 z-[100] bg-[var(--overlay-scrim)] flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className={`room-planner-modal w-full ${wide ? 'max-w-6xl' : 'max-w-xl'} max-h-[92vh] overflow-y-auto rounded-2xl`} style={{ background: SURFACE }}><div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5" style={{ background: SURFACE, borderBottom: `1px solid ${BORDER}` }}><h2 className="text-base font-semibold" style={{ color: NAVY }}>{title}</h2><button type="button" aria-label="Close" onClick={onClose} className="room-planner-icon-close rounded-lg p-2" style={{ color: MUTED }}><X size={18}/></button></div>{children}</div></div>; }
