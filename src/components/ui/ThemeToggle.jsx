import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/theme/ThemeProvider';

const OPTIONS=[
  {mode:'light',label:'Light',Icon:Sun},
  {mode:'dark',label:'Dark',Icon:Moon},
  {mode:'system',label:'System',Icon:Monitor},
];

export default function ThemeToggle({compact=false}){
  const {mode,setMode}=useTheme();
  return <div className="theme-toggle inline-flex items-center gap-1 rounded-xl border p-1" role="group" aria-label="Color theme">
    {OPTIONS.map(({mode:option,label,Icon})=><button
      key={option}
      type="button"
      className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors"
      style={{background:mode===option?'var(--primary-soft)':'transparent',color:mode===option?'var(--text)':'var(--text-muted)',border:mode===option?'1px solid var(--border)':'1px solid transparent'}}
      aria-label={label+' theme'}
      aria-pressed={mode===option}
      title={label}
      onClick={()=>setMode(option)}
    ><Icon size={15} aria-hidden="true"/><span className={compact ? 'hidden md:inline' : undefined}>{label}</span></button>)}
  </div>;
}
