import { CheckCircle2, Loader2, XCircle } from "lucide-react";

export type PhotoUploadStatus = "uploading" | "success" | "error";

const STATUS_CONFIG: Record<PhotoUploadStatus, { Icon: typeof CheckCircle2; className: string; label: string }> = {
  uploading: { Icon: Loader2, className: "text-muted-foreground animate-spin", label: "Sedang mengunggah" },
  success: { Icon: CheckCircle2, className: "text-emerald-600", label: "Berhasil diunggah" },
  error: { Icon: XCircle, className: "text-destructive", label: "Gagal diunggah" },
};

// Overlay tampilan murni untuk menandai status upload satu foto — tidak
// melakukan fetch, tidak menyimpan state apa pun sendiri. Parent WAJIB
// punya className="relative" di elemen pembungkus foto agar posisi
// absolut ini benar. Merender null saat status undefined (idle — foto
// belum diambil / belum ada upaya upload).
export function PhotoStatusOverlay({ status }: { status?: PhotoUploadStatus }) {
  if (!status) return null;
  const { Icon, className, label } = STATUS_CONFIG[status];
  return (
    <span
      title={label}
      aria-label={label}
      className="absolute -top-1.5 -right-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-background shadow-sm"
    >
      <Icon className={`size-3.5 ${className}`} />
    </span>
  );
}
