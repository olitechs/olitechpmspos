import React,{createContext,useCallback,useContext,useEffect,useMemo,useState} from 'react';

const KEY='olitech_theme_mode';
const ThemeContext=createContext(null);
const readMode=()=>{try{const saved=localStorage.getItem(KEY);return ['light','dark','system'].includes(saved)?saved:'system'}catch{return 'system'}};
const prefersDark=()=>typeof window!=='undefined'&&typeof window.matchMedia==='function'&&window.matchMedia('(prefers-color-scheme: dark)').matches;

export function ThemeProvider({children}){
  const [mode,setModeState]=useState(readMode);
  const [systemDark,setSystemDark]=useState(prefersDark);
  useEffect(()=>{
    if(typeof window==='undefined'||typeof window.matchMedia!=='function')return undefined;
    const mq=window.matchMedia('(prefers-color-scheme: dark)');
    const h=e=>setSystemDark(e.matches);
    if(mq.addEventListener)mq.addEventListener('change',h);else mq.addListener?.(h);
    return()=>{if(mq.removeEventListener)mq.removeEventListener('change',h);else mq.removeListener?.(h)};
  },[]);
  const resolvedTheme=mode==='system'?(systemDark?'dark':'light'):mode;
  useEffect(()=>{
    const r=document.documentElement;
    r.setAttribute('data-theme',resolvedTheme);
    r.classList.toggle('dark',resolvedTheme==='dark');
    r.style.colorScheme=resolvedTheme;
  },[resolvedTheme]);
  const setMode=useCallback(m=>{
    if(!['light','dark','system'].includes(m))return;
    setModeState(m);
    try{localStorage.setItem(KEY,m)}catch{}
  },[]);
  const value=useMemo(()=>({mode,resolvedTheme,setMode,isDark:resolvedTheme==='dark'}),[mode,resolvedTheme,setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme(){
  const v=useContext(ThemeContext);
  if(!v)throw new Error('useTheme must be used inside ThemeProvider');
  return v;
}
