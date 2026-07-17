import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-3">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
      >
        <ChevronLeft className="size-3.5" />
        Sebelumnya
      </Button>
      <span className="text-xs text-muted-foreground">
        Halaman {page} / {pageCount}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange(page + 1)}
        disabled={page >= pageCount}
      >
        Berikutnya
        <ChevronRight className="size-3.5" />
      </Button>
    </div>
  );
}
