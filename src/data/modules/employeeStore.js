import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useEmployeeStore = create(persist((set)=>({
 employees:[], roles:[], permissions:[], accessMatrix:{}, timecards:[],
 setEmployees:employees=>set({employees:Array.isArray(employees)?employees:[]}),
 setRoles:roles=>set({roles:Array.isArray(roles)?roles:[]}),
 setPermissions:permissions=>set({permissions:Array.isArray(permissions)?permissions:[]}),
 setAccess:(role,permission,value)=>set(s=>({accessMatrix:{...s.accessMatrix,[role]:{...(s.accessMatrix[role]||{}),[permission]:!!value}}})),
 setTimecards:timecards=>set({timecards:Array.isArray(timecards)?timecards:[]}),
}),{name:'olitech-employee-store'}));
