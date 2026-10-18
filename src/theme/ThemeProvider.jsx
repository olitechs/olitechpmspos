import React,{createContext,useContext,useEffect,useMemo} from 'react';

const ThemeContext=createContext(null);

/** Coastal Linen is the only supported application theme. */
export function ThemeProvider({children}){
  useEffect(()=>{
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme='light';
    try{localStorage.setItem('olitech_theme_mode','light')}catch{}
  },[]);
  const value=useMemo(()=>({mode:'light',resolvedTheme:'light',setMode:()=>{},isDark:false}),[]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme(){const value=useContext(ThemeContext);if(!value)throw new Error('useTheme must be used inside ThemeProvider');return value;}
