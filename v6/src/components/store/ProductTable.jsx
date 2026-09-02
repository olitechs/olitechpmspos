import React from 'react';
import { Edit3, Plus } from 'lucide-react';

const pct = (p) => {
  const max = Number(p.max_stock || Math.max(Number(p.min_stock || 1) * 3, Number(p.current_stock || 1)));
  return Math.min(100, Math.max(4, (Number(p.current_stock || 0) / Math.max(1, max)) * 100));
};

export default function ProductTable({ products, onEdit, onAdd, showCost = true }) {
  return <div className="bg-white border-2 border-[#090C11] rounded-2xl overflow-hidden">
    <div className="flex items-center justify-between px-4 py-3 border-b-2 border-[#090C11]"><div className="text-xs font-black uppercase tracking-widest">Products</div>{onAdd&&<button onClick={onAdd} className="px-3 py-2 rounded-lg bg-[#FFD300] text-[#090C11] font-black text-xs flex items-center gap-1"><Plus size={14}/> Add Product</button>}</div>
    <div className="overflow-auto">
      <table className="w-full min-w-[1050px] text-sm"><thead className="bg-[#090C11] text-white"><tr>{['SKU','Product','Category','Location','Stock','Min',...(showCost?['Cost']:[]),'Selling','Supplier','Expiry',''].map((h) => <th key={h} className="text-left px-3 py-2 text-[10px] uppercase tracking-wider">{h}</th>)}</tr></thead>
        <tbody>{products.map((p) => { const stock=Number(p.current_stock||0), min=Number(p.min_stock||0); const danger=stock<=0, low=!danger&&stock<=min; return <tr key={p.id} className="border-b border-gray-200 hover:bg-gray-50"><td className="px-3 py-3 font-mono text-xs">{p.sku||'—'}</td><td className="px-3 py-3 font-black">{p.name}</td><td className="px-3 py-3">{p.category}</td><td className="px-3 py-3 text-xs">{p.location}</td><td className="px-3 py-3 min-w-[130px]"><div className="flex items-center gap-2"><div className="h-2 rounded-full bg-gray-200 w-20 overflow-hidden"><div className="h-full rounded-full" style={{ width:`${pct(p)}%`, background: danger?'#EF4444':low?'#EAB308':'#22C55E' }}/></div><b className={danger?'text-red-600':low?'text-yellow-700':'text-green-700'}>{stock} {p.unit}</b></div></td><td className="px-3 py-3">{min}</td>{showCost && <td className="px-3 py-3">KES {Number(p.cost_price||0).toLocaleString()}</td>}<td className="px-3 py-3">KES {Number(p.selling_price||0).toLocaleString()}</td><td className="px-3 py-3 text-xs">{p.supplier?.name||'—'}</td><td className="px-3 py-3 text-xs">{p.expiry_date||'—'}</td><td className="px-3 py-3">{onEdit&&<button onClick={()=>onEdit(p)} className="p-2 rounded-lg border border-gray-300 hover:bg-[#FFD300]"><Edit3 size={14}/></button>}</td></tr>; })}</tbody>
      </table>
      {!products.length && <div className="p-10 text-center text-sm text-gray-500">No products match the current filters.</div>}
    </div>
  </div>;
}
