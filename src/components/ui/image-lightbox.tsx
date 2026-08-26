"use client";

import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

// Click-to-enlarge popup for a single thumbnail — no header/padding, just
// the full-size image on a dark backdrop, dismissed by clicking outside or
// closing the dialog (DialogContent's own built-in behavior). Generic over
// any thumbnail image in the app, not vehicle-check-specific.
export function ImageLightboxTrigger({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {/* eslint-disable-next-line @next/next/no-img-element -- thumbnail source is a remote/proxied URL, not a static build asset */}
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl border-none bg-transparent p-0 shadow-none">
          {/* eslint-disable-next-line @next/next/no-img-element -- same remote/proxied source as the thumbnail above, shown at full size */}
          <img src={src} alt={alt} className="max-h-[85vh] w-full rounded-lg object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}
