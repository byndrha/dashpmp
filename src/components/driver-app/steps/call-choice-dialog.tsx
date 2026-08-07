"use client";

import { Phone, MessageCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toWhatsAppUrl } from "@/lib/format";

export function CallChoiceDialog({
  open,
  onOpenChange,
  mobileNo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mobileNo: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hubungi Pelanggan</DialogTitle>
        </DialogHeader>
        <div className="flex gap-3">
          <a
            href={`tel:${mobileNo}`}
            onClick={() => onOpenChange(false)}
            className="flex flex-1 flex-col items-center gap-2 rounded-lg border border-border py-4 text-sm font-medium hover:bg-muted"
          >
            <Phone className="size-6 text-primary" />
            Telepon
          </a>
          <a
            href={toWhatsAppUrl(mobileNo)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onOpenChange(false)}
            className="flex flex-1 flex-col items-center gap-2 rounded-lg border border-border py-4 text-sm font-medium hover:bg-muted"
          >
            <MessageCircle className="size-6 text-green-600" />
            WhatsApp
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
