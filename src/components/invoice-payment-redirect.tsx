"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

const REDIRECT_SECONDS = 5;

// Apakah halaman ini dibuka di dalam iframe (mis. popup pratinjau SI di
// /mkesindo/pemesanan). Dibaca lewat useSyncExternalStore: render server
// selalu "bukan iframe", lalu klien membaca nilai sebenarnya tanpa setState.
function diDalamIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // akses window.top ditolak = pasti di dalam iframe lintas origin
  }
}
const tanpaLangganan = () => () => {};

// Shown only once an invoice is confirmed Lunas — gives the customer a
// moment to read the "Lunas" confirmation before automatically continuing
// to the payment document, with a button for anyone who doesn't want to
// wait (or whose redirect gets blocked/delayed).
//
// Di dalam iframe (pratinjau dari dashboard) TIDAK ada pengalihan otomatis:
// pratinjaunya harus tetap menampilkan SI, dan tombolnya membuka dokumen
// pembayaran di tab baru alih-alih mengganti isi popup.
export function InvoicePaymentRedirect({ paymentToken }: { paymentToken: string }) {
  const embedded = useSyncExternalStore(tanpaLangganan, diDalamIframe, () => false);
  const href = `/mkesindo/payment/${paymentToken}`;

  if (embedded) {
    return (
      <div className="mt-4 flex flex-col items-center gap-2 border-t pt-4">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Lihat Dokumen Pembayaran
        </a>
      </div>
    );
  }
  return <PengalihanOtomatis href={href} />;
}

function PengalihanOtomatis({ href }: { href: string }) {
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState(REDIRECT_SECONDS);

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
