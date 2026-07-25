import { getInvoiceByToken } from "@/lib/queries/invoice-public";
import { formatDate, formatRupiah } from "@/lib/format";

export default async function PublicInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invoice = await getInvoiceByToken(token);

  if (!invoice) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Invoice tidak ditemukan</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Link ini tidak valid atau sudah tidak berlaku. Hubungi PT Mitra Kelola Esindo untuk bantuan.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">
        <p className="text-xs text-muted-foreground">Tagihan untuk</p>
        <h1 className="text-lg font-semibold">{invoice.CustomerName}</h1>

        <div className="mt-4 flex flex-col gap-1 rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">No. Voucher</span>
            <span className="font-medium">{invoice.VoucherNo}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tanggal</span>
            <span className="font-medium">{formatDate(invoice.TransDate)}</span>
          </div>
          {invoice.DueDate && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Jatuh Tempo</span>
              <span className="font-medium">{formatDate(invoice.DueDate)}</span>
            </div>
          )}
        </div>

        <div className="mt-4 text-center">
          <p className="text-xs text-muted-foreground">Total Tagihan</p>
          <p className="text-2xl font-semibold">{formatRupiah(invoice.Netto)}</p>
        </div>

        <div className="mt-4 flex flex-col items-center gap-2">
          <div className="flex size-48 items-center justify-center rounded-lg bg-black">
            <span className="text-xs text-white">QRIS segera hadir</span>
          </div>
          <p className="text-xs text-muted-foreground">Pembayaran QRIS akan tersedia di sini</p>
        </div>
      </div>
    </main>
  );
}
