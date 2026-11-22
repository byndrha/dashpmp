"use client";

// Petunjuk = tooltip bergaya aplikasi (judul tebal + isi redup) sebagai
// pengganti atribut `title` bawaan browser, yang tampil sebagai kotak polos
// dan tidak bisa diberi gaya. Pemicu dirender sebagai elemen pembungkus
// (span bawaan) supaya tata letak anak tidak berubah.
import type { ReactElement, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function Petunjuk({
  judul,
  isi,
  children,
  side = "top",
  render,
}: {
  judul?: ReactNode;
  isi?: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  // Elemen pembungkus pemicu (bawaan <span />). Kelas tata letak taruh di sini.
  render?: ReactElement<Record<string, unknown>>;
}) {
  if (!judul && !isi) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger render={render ?? <span />}>{children}</TooltipTrigger>
      <TooltipContent side={side}>
        {judul && <p className="font-semibold text-foreground">{judul}</p>}
        {isi && <p className="text-muted-foreground">{isi}</p>}
      </TooltipContent>
    </Tooltip>
  );
}
