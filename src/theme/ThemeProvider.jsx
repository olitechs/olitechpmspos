import React,{createContext,useContext,useEffect,useMemo,useState} from 'react';

const ThemeContext=createContext(null);
const STORAGE_KEY='olitech_theme_mode';

function workspaceDefault(){
  if(typeof window==='undefined') return 'light';
  const path=window.location.pathname.toLowerCase();
  return path.includes('kitchen')||path.includes('kds')?'dark':'light';
}

export function ThemeProvider({children}){
  const [mode,setMode]=useState(()=>{try{return localStorage.getItem(STORAGE_KEY)||workspaceDefault()}catch{return workspaceDefault()}});
  const [systemDark,setSystemDark]=useState(()=>typeof window!=='undefined'&&window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  useEffect(()=>{try{localStorage.setItem(STORAGE_KEY,mode)}catch{}},[mode]);
  useEffect(()=>{
    const media=window.matchMedia?.('(prefers-color-scheme: dark)');
    if(!media) return;
    const onChange=e=>setSystemDark(e.matches);
    media.addEventListener?.('change',onChange);
    return()=>media.removeEventListener?.('change',onChange);
  },[]);

  const resolved=mode==='system'?(systemDark?'dark':'light'):mode;
  useEffect(()=>{
    document.documentElement.dataset.theme=resolved;
    document.documentElement.style.colorScheme=resolved;
  },[resolved]);

  const value=useMemo(()=>({mode,resolvedTheme:resolved,setMode,isDark:resolved==='dark'}),[mode,resolved]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme(){const value=useContext(ThemeContext);if(!value)throw new Error('useTheme must be used inside ThemeProvider');return value;}
