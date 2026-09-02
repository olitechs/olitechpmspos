import React from 'react';
import { useNavigate } from 'react-router-dom';
import { UtensilsCrossed, LayoutDashboard, Package, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

export default function POSTabs({ activeModule, onModuleChange }) {
  const navigate=useNavigate(); const {user}=useAuth();
  const canAdmin=user?.isPlatformOwner||['owner','admin','hotel_admin','super_admin'].includes(String(user?.staff?.role||user?.propertyRole||'').toLowerCase());
  const tabs=[{id:'pos',label:'POS',icon:UtensilsCrossed,path:'/pos'},{id:'dashboard',label:'Back Office',icon:LayoutDashboard,path:'/backoffice'},{id:'store',label:'Store',icon:Package,path:'/store'},...(canAdmin?[{id:'roles',label:'Admin',icon:ShieldCheck,path:'/admin/roles'}]:[])];
  return <nav className="flex items-stretch shrink-0 w-full bg-[#090C11] border-t border-white/10" style={{height:'60px'}}>{tabs.map(({id,label,icon:Icon,path})=>{const active=id==='dashboard'?['dashboard','reservations','rooms','guests','kitchen','housekeeping','maintenance','reports'].includes(activeModule):activeModule===id;return <button key={id} onClick={()=>{if(id==='roles'){navigate(path);return;}onModuleChange(id);navigate(path);}} className="flex-1 flex flex-col items-center justify-center gap-1"><Icon size={18} className={active?'text-[#FFD300]':'text-white/45'}/><span className={`text-[10px] font-black ${active?'text-[#FFD300]':'text-white/45'}`}>{label}</span></button>})}</nav>;
}
