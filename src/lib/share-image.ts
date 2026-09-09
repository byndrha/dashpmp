// Shared by route-validation-dialog.tsx's single-route Bagikan (Seluruhnya/
// Data Rute) and pengiriman-board.tsx's batch "Bagikan Semua Rute" — same
// clipboard-first-then-share-then-download chain either way, so a batch
// share of one merged image behaves identically to sharing a single route's
// screenshot.
export async function shareImageBlob(blob: Blob, filename: string, title: string): Promise<void> {
  const file = new File([blob], filename, { type: "image/png" });

  // Copy to clipboard FIRST, before calling share() — both APIs need a live
  // user-activation gesture, and awaiting the OS share sheet can take
  // arbitrarily long (or hand off to another app entirely), which risks the
  // activation expiring before a clipboard write attempted afterward. Doing
  // it up front also means it still happens even when the user cancels the
  // share sheet, or shares to an app that can't receive the image directly.
  let copied = false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    copied = true;
  } catch {
    // Clipboard image write isn't universally supported (e.g. Firefox) —
    // proceed to share/download regardless.
  }

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
    } catch {
      // User cancelled the share sheet — not an error worth surfacing.
    }
    if (copied) (await import("sonner")).toast.success("Gambar disalin ke clipboard.");
    return;
  }

  if (copied) {
    (await import("sonner")).toast.success("Gambar disalin ke clipboard.");
    return;
  }
  // Final fallback when neither share nor clipboard write is available.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Same clipboard-first-then-share chain as shareImageBlob, for plain text —
// backs both the single-route "Detail Rute" share and the batch version
// (one combined text block for every route instead of one image).
export async function shareTextBlock(text: string, title: string): Promise<void> {
  const { toast } = await import("sonner");
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    // Proceed to share regardless.
  }

  if (navigator.share) {
    try {
      await navigator.share({ title, text });
    } catch {
      // User cancelled the share sheet — not an error worth surfacing.
    }
    if (copied) toast.success("Detail rute disalin ke clipboard.");
    return;
  }

  if (copied) {
    toast.success("Detail rute disalin ke clipboard.");
  } else {
    toast.error("Gagal menyalin detail rute.");
  }
}

// Stacks N route screenshots into ONE tall PNG, each preceded by a small
// label band (armada + waktu) so the combined image still reads as "one
// route per section" once flattened — batch Bagikan shares this single
// merged image exactly like a normal one-route screenshot (one clipboard
// copy, one shared file), per explicit request: "hanya satu gambar yang
// tersalin ke clipboard", not one file per route.
export async function mergeImagesVertically(parts: { label: string; blob: Blob }[]): Promise<Blob> {
  if (parts.length === 0) throw new Error("Tidak ada gambar untuk digabungkan.");
  const LABEL_HEIGHT = 44;
  const GAP = 20;

  const images = await Promise.all(
    parts.map(
      (p) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error(`Gagal memuat gambar untuk "${p.label}".`));
          img.src = URL.createObjectURL(p.blob);
        })
    )
  );

  try {
    const width = Math.max(...images.map((img) => img.width));
    const totalHeight =
      images.reduce((sum, img) => sum + img.height, 0) + parts.length * LABEL_HEIGHT + (parts.length - 1) * GAP;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = totalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context tidak tersedia di browser ini.");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, totalHeight);

    let y = 0;
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      ctx.fillStyle = "#f1f5f9";
      ctx.fillRect(0, y, width, LABEL_HEIGHT);
      ctx.fillStyle = "#0f172a";
      ctx.font = "600 20px system-ui, -apple-system, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(parts[i].label, 16, y + LABEL_HEIGHT / 2, width - 32);
      y += LABEL_HEIGHT;
      ctx.drawImage(img, 0, y, img.width, img.height);
      y += img.height;
      if (i < images.length - 1) y += GAP;
    }

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Gagal membuat gambar gabungan."))), "image/png");
    });
  } finally {
    for (const img of images) URL.revokeObjectURL(img.src);
  }
}
