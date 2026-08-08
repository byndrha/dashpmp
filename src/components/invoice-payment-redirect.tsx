"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const REDIRECT_SECONDS = 5;

// Shown only once an invoice is confirmed Lunas — gives the customer a
// moment to read the "Lunas" confirmation before automatically continuing
// to the payment document, with a button for anyone who doesn't want to
// wait (or whose redirect gets blocked/delayed).
export function InvoicePaymentRedirect({ paymentToken }: { paymentToken: string }) {
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState(REDIRECT_SECONDS);
  const href = `/mkesindo/payment/${paymentToken}`;

  useEffect(() => {
    if (secondsLeft <= 0) {
      router.replace(href);
      return;
    }
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft, router, href]);

  return (
    <div className="mt-4 flex flex-col items-center gap-2 border-t pt-4">
      <a
        href={href}
        className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Menuju Dokumen Pembayaran
      </a>
      <p className="text-xs text-muted-foreground">Mengalihkan otomatis dalam {secondsLeft} detik...</p>
    </div>
  );
}
