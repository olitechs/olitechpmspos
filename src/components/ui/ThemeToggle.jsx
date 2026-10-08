import React from 'react';
import {Monitor, Moon, Sun} from 'lucide-react';
import {useTheme} from '@/theme/ThemeProvider';

export default function ThemeToggle({compact=false}){
 const {mode,setMode,resolvedTheme}=useTheme();
 const next=()=>setMode(mode==='light'?'dark':mode==='dark'?'system':'light');
 const Icon=mode==='system'?Monitor:mode==='dark'?Moon:Sun;
 const label=mode==='system'?'System':mode==='dark'?'Dark':'Light';
 return <button type="button" onClick={next} title={`Theme: ${label}. Click to switch.`} aria-label={`Theme ${label}. Click to switch`} className={`theme-toggle min-h-12 ${compact?'px-3':'px-4'} rounded-xl border font-semibold inline-flex items-center justify-center gap-2`}>
   <Icon size={17}/>{!compact&&<span>{label}</span>}<span className="sr-only">Current resolved theme: {resolvedTheme}</span>
 </button>;
}
