import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn("peer h-[18px] w-[18px] shrink-0 rounded-[3px] border border-[#BDBDBD] bg-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-[#8BC34A]/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[#4CAF50] data-[state=checked]:bg-[#4CAF50] data-[state=indeterminate]:border-[#4CAF50] data-[state=indeterminate]:bg-[#4CAF50]", className)}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex h-full w-full items-center justify-center text-white">
      {props.checked === "indeterminate" ? <Minus size={13} strokeWidth={3} /> : <Check size={13} strokeWidth={3} />}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
export { Checkbox };
