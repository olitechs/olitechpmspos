import React from 'react';
import {CheckCircle2,CircleDot,Clock3,DoorOpen,LogOut,MinusCircle,ReceiptText} from 'lucide-react';

const bars=[
 ['optioned','Optioned',CircleDot],
 ['confirmed','Confirmed / arriving',Clock3],
 ['occupied','In-house',DoorOpen],
 ['checkout','Checking out today',LogOut],
 ['checked_out','Checked out',CheckCircle2],
 ['closed','Out of order / closure',MinusCircle],
];
const payments=[['none','No amount paid'],['partial','Partially paid'],['total','Total paid']];

export default function StatusLegend(){
 return <div className="status-legend flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
  <div className="font-bold text-[var(--text)]">Stay status</div>
  {bars.map(([key,label,Icon])=><span key={key} className="inline-flex items-center gap-1.5"><span className={`legend-swatch legend-${key}`}/><Icon size={13}/>{label}</span>)}
  <div className="font-bold text-[var(--text)] ml-2">Payment</div>
  {payments.map(([key,label])=><span key={key} className="inline-flex items-center gap-1.5"><span className={`payment-chip payment-${key}`} />{label}</span>)}
  <span className="inline-flex items-center gap-1.5"><ReceiptText size={13}/>Color is paired with a label/icon</span>
 </div>;
}
