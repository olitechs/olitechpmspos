import React from 'react';
import { Skeleton } from '@/components/ui';

// Shared, workspace-shaped loading layouts built on the existing Skeleton primitive.
function Placeholder({ className = '', lines = 1 }) {
  return <Skeleton className={className} lines={lines} />;
}

function Sidebar({ admin }) {
  return <aside aria-hidden="true" className="hidden min-h-screen w-64 shrink-0 border-r border-[var(--border)] bg-[var(--surface)] p-4 lg:block">
    <div className="mb-8 flex items-center gap-3"><div className="h-10 w-10 animate-pulse rounded-xl bg-[var(--surface-2)]"/><div className="min-w-0 flex-1 space-y-2"><Placeholder className="[&>div]:h-3 [&>div]:w-28"/><Placeholder className="[&>div]:h-2 [&>div]:w-20"/></div></div>
    <div className="space-y-2">{Array.from({length:admin?7:9},(_,i)=><div key={i} className="flex items-center gap-3 rounded-lg px-3 py-3"><div className="h-5 w-5 animate-pulse rounded bg-[var(--surface-2)]"/><div className="flex-1"><Placeholder className="[&>div]:h-3 [&>div]:w-3/4"/></div></div>)}</div>
  </aside>;
}

function Stats() {
  return <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{Array.from({length:4},(_,i)=><div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><Placeholder className="mb-4 [&>div]:h-3 [&>div]:w-2/3"/><Placeholder className="mb-2 [&>div]:h-7 [&>div]:w-1/2"/><Placeholder className="[&>div]:h-2 [&>div]:w-3/4"/></div>)}</div>;
}

function TableSkeleton() {
  return <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]"><div className="flex justify-between border-b border-[var(--border)] p-4"><Placeholder className="[&>div]:h-4 [&>div]:w-36"/><Placeholder className="[&>div]:h-8 [&>div]:w-24"/></div><div className="px-4">{Array.from({length:5},(_,i)=><div key={i} className="grid grid-cols-3 gap-4 border-b border-[var(--border)] py-4 last:border-0 sm:grid-cols-4"><Placeholder className="[&>div]:h-3"/><Placeholder className="hidden sm:block [&>div]:h-3"/><Placeholder className="[&>div]:h-3"/><Placeholder className="hidden sm:block [&>div]:h-3"/></div>)}</div></div>;
}

function PosSkeleton() {
  return <div className="space-y-5"><div className="flex gap-2 overflow-hidden">{Array.from({length:6},(_,i)=><div key={i} className="h-9 w-24 shrink-0 animate-pulse rounded-full bg-[var(--surface-2)]"/>)}</div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{Array.from({length:8},(_,i)=><div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><div className="mb-3 aspect-[4/3] animate-pulse rounded-lg bg-[var(--surface-2)]"/><Placeholder className="mb-2 [&>div]:h-3 [&>div]:w-4/5"/><Placeholder className="[&>div]:h-3 [&>div]:w-1/3"/></div>)}</div></div>;
}

function RoomSkeleton() {
  return <div className="space-y-3">{Array.from({length:5},(_,i)=><div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><div className="mb-3 flex justify-between"><Placeholder className="[&>div]:h-4 [&>div]:w-28"/><Placeholder className="[&>div]:h-3 [&>div]:w-16"/></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">{Array.from({length:6},(_,j)=><div key={j} className="h-16 animate-pulse rounded-lg bg-[var(--surface-2)] sm:h-20"/>)}</div></div>)}</div>;
}


export function PageDataSkeleton({ variant = 'table', rows = 5, className = '' }) {
  const rowCount = Math.max(3, Math.min(8, rows));
  return <div role="status" aria-label="Loading page data" aria-live="polite" className={`w-full min-w-0 space-y-4 ${className}`.trim()}>
    <span className="sr-only">Loading page data…</span>
    {variant === 'report' && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({length:4},(_,i)=><div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><Placeholder className="mb-4 [&>div]:h-3 [&>div]:w-2/3"/><Placeholder className="mb-2 [&>div]:h-7 [&>div]:w-1/2"/><Placeholder className="[&>div]:h-2 [&>div]:w-3/4"/></div>)}</div>}
    {variant === 'cards' && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({length:rowCount},(_,i)=><div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="mb-4 flex items-center gap-3"><div className="h-10 w-10 animate-pulse rounded-full bg-[var(--surface-2)]"/><div className="min-w-0 flex-1"><Placeholder className="mb-2 [&>div]:h-3 [&>div]:w-2/3"/><Placeholder className="[&>div]:h-2 [&>div]:w-1/2"/></div></div><Placeholder lines={2} className="[&>div]:h-3"/></div>)}</div>}
    {variant === 'list' && <div className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4">{Array.from({length:rowCount},(_,i)=><div key={i} className="flex items-center gap-3 py-4"><div className="h-9 w-9 animate-pulse rounded-full bg-[var(--surface-2)]"/><div className="min-w-0 flex-1"><Placeholder className="mb-2 [&>div]:h-3 [&>div]:w-2/3"/><Placeholder className="[&>div]:h-2 [&>div]:w-1/3"/></div><Placeholder className="w-20 [&>div]:h-6"/></div>)}</div>}
    {(variant === 'table' || variant === 'report') && <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]"><div className="grid grid-cols-3 gap-3 border-b border-[var(--border)] bg-[var(--surface-2)] p-3 sm:grid-cols-5">{Array.from({length:5},(_,i)=><Placeholder key={i} className={`${i>2?'hidden sm:block ':''}[&>div]:h-3`}/>)}</div><div className="px-3">{Array.from({length:rowCount},(_,i)=><div key={i} className="grid grid-cols-3 gap-3 border-b border-[var(--border)] py-4 last:border-0 sm:grid-cols-5">{Array.from({length:5},(_,j)=><Placeholder key={j} className={`${j>2?'hidden sm:block ':''}[&>div]:h-3`}/>)}</div>)}</div></div>}
  </div>;
}

export default function AppLoadingSkeleton({variant='dashboard',label='Loading workspace',className='',fullScreen=true}) {
  const admin=variant==='admin',pos=variant==='pos',rooms=variant==='rooms';
  return <div role="status" aria-live="polite" aria-label={label} className={`${fullScreen ? 'fixed inset-0 z-[100] min-h-screen' : 'relative min-h-[22rem] w-full rounded-xl'} flex overflow-hidden bg-[var(--canvas)] text-[var(--text)] ${className}`.trim()}>
    <span className="sr-only">{label}</span>{fullScreen && <Sidebar admin={admin}/>} 
    <div className="flex min-w-0 flex-1 flex-col">
      {fullScreen && <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 sm:px-6"><div className="flex items-center gap-3"><div className="h-9 w-9 animate-pulse rounded-lg bg-[var(--surface-2)] lg:hidden"/><Placeholder className="[&>div]:h-4 [&>div]:w-32 sm:[&>div]:w-44"/></div><div className="flex items-center gap-3"><div className="hidden w-36 sm:block"><Placeholder className="[&>div]:h-8"/></div><div className="h-9 w-9 animate-pulse rounded-full bg-[var(--surface-2)]"/></div></header>}
      <main className={`min-h-0 flex-1 overflow-auto p-4 sm:p-6 ${fullScreen ? 'xl:p-8' : 'xl:p-5'}`}><div className="mx-auto max-w-[1600px] space-y-6"><div className="flex flex-wrap items-start justify-between gap-3"><div className="w-full max-w-md space-y-3"><Placeholder className="[&>div]:h-7 [&>div]:w-2/3"/><Placeholder className="[&>div]:h-3 [&>div]:w-full sm:[&>div]:w-4/5"/></div><div className="hidden w-28 sm:block"><Placeholder className="[&>div]:h-9"/></div></div>{pos?<PosSkeleton/>:rooms?<RoomSkeleton/>:<>{<Stats/>}{admin?<div className="grid gap-5 xl:grid-cols-2"><TableSkeleton/><TableSkeleton/></div>:<TableSkeleton/>}</>}</div></main>
    </div>
  </div>;
}