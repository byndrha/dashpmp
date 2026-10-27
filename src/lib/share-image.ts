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

// Lays N route screenshots out as a grid in ONE PNG, each card preceded by a
// small label band (armada + waktu). Cards are portrait (tall, narrow — the
// dialog is forced into its stacked layout while capturing), so the grid
// grows sideways first: up to 12 routes -> 4 columns (3 rows), more ->
// 6 columns (5 rows for 30). Still a single image / single clipboard copy,
// per the original "hanya satu gambar" requirement.
export function gridColumnsFor(count: number): number {
  return count <= 12 ? 4 : 6;
}

export async function mergeImagesGrid(parts: { label: string; blob: Blob }[]): Promise<Blob> {
  if (parts.length === 0) throw new Error("Tidak ada gambar untuk digabungkan.");
  const LABEL_HEIGHT = 44;
  const GAP = 20;
  const CELL_WIDTH = 640;
  const MAX_CANVAS_SIDE = 16000;

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
    const cols = Math.min(gridColumnsFor(parts.length), parts.length);
    const rows = Math.ceil(parts.length / cols);
    const drawnHeight = (img: HTMLImageElement) => Math.round((img.height * CELL_WIDTH) / img.width);

    const rowHeights: number[] = [];
    for (let r = 0; r < rows; r++) {
      const inRow = images.slice(r * cols, r * cols + cols);
      rowHeights.push(LABEL_HEIGHT + Math.max(...inRow.map(drawnHeight)));
    }
    const rawWidth = cols * CELL_WIDTH + (cols - 1) * GAP;
    const rawHeight = rowHeights.reduce((a, b) => a + b, 0) + (rows - 1) * GAP;
    // Browsers cap canvas side length — shrink everything uniformly if a
    // very long route list would blow past it.
    const k = Math.min(1, MAX_CANVAS_SIDE / rawWidth, MAX_CANVAS_SIDE / rawHeight);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(rawWidth * k);
    canvas.height = Math.round(rawHeight * k);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context tidak tersedia di browser ini.");
    ctx.scale(k, k);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rawWidth, rawHeight);

    let y = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx >= images.length) break;
        const img = images[idx];
        const x = c * (CELL_WIDTH + GAP);
        ctx.fillStyle = "#f1f5f9";
        ctx.fillRect(x, y, CELL_WIDTH, LABEL_HEIGHT);
        ctx.fillStyle = "#0f172a";
        ctx.font = "600 22px system-ui, -apple-system, sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(parts[idx].label, x + 14, y + LABEL_HEIGHT / 2, CELL_WIDTH - 28);
        ctx.drawImage(img, x, y + LABEL_HEIGHT, CELL_WIDTH, drawnHeight(img));
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, CELL_WIDTH, LABEL_HEIGHT + drawnHeight(img));
      }
      y += rowHeights[r] + GAP;
    }

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Gagal membuat gambar gabungan."))), "image/png");
    });
  } finally {
    for (const img of images) URL.revokeObjectURL(img.src);
  }
}
