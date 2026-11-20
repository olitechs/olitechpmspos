import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog=DialogPrimitive.Root;
const DialogTrigger=DialogPrimitive.Trigger;
const DialogPortal=DialogPrimitive.Portal;
const DialogClose=DialogPrimitive.Close;
const DialogOverlay=React.forwardRef(({className,...props},ref)=>(
	  <DialogPrimitive.Overlay ref={ref} className={cn("fixed inset-0 z-[var(--z-overlay)] bg-[var(--overlay-scrim)] data-[state=open]:animate-in data-[state=closed]:animate-out",className)} {...props}/>
));
DialogOverlay.displayName=DialogPrimitive.Overlay.displayName;

/**
 * Dialog panel.
 *
 * The panel is a flex column with a fixed height budget, so the header and
 * footer stay on screen and only `DialogBody` scrolls. That is what keeps the
 * close button and the action buttons reachable on a short laptop viewport.
 */
const DialogContent=React.forwardRef(({className,children,...props},ref)=>(
  <DialogPortal>
    <DialogOverlay/>
    <DialogPrimitive.Content
      ref={ref}
      className={cn("modal-panel font-body text-[var(--text)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out",className)}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-3 top-3 z-[1] inline-flex h-11 w-11 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] disabled:pointer-events-none">
        <X className="h-4 w-4"/><span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName=DialogPrimitive.Content.displayName;

const DialogHeader=({className,...props})=>(
  <div className={cn("modal-header flex flex-col gap-1.5 border-b border-[var(--border)] px-[var(--modal-pad)] py-4 pr-14 text-left",className)} {...props}/>
);
DialogHeader.displayName="DialogHeader";

const DialogBody=({className,...props})=>(
  <div className={cn("modal-body scroll-shadow-y px-[var(--modal-pad)] py-4",className)} {...props}/>
);
DialogBody.displayName="DialogBody";

const DialogFooter=({className,...props})=>(
  <div className={cn("modal-footer flex flex-col-reverse gap-2 border-t border-[var(--border)] px-[var(--modal-pad)] py-4 sm:flex-row sm:justify-end",className)} {...props}/>
);
DialogFooter.displayName="DialogFooter";

const DialogTitle=React.forwardRef(({className,...props},ref)=><DialogPrimitive.Title ref={ref} className={cn("text-[length:var(--text-fluid-lg)] font-semibold leading-tight tracking-tight text-[var(--text)]",className)} {...props}/>);
DialogTitle.displayName=DialogPrimitive.Title.displayName;
const DialogDescription=React.forwardRef(({className,...props},ref)=><DialogPrimitive.Description ref={ref} className={cn("text-sm text-[var(--text-muted)]",className)} {...props}/>);
DialogDescription.displayName=DialogPrimitive.Description.displayName;
export { Dialog, DialogTrigger, DialogPortal, DialogClose, DialogOverlay, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle, DialogDescription };
