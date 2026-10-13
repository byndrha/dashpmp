// Rincian isi pesanan per faktur pada kartu piutang: Kantong 10 KG / 5 KG /
// Bonus beserta jumlahnya. ItemID mengikuti KANTONG_VARIANTS & bonus di
// sales-order.ts: 019 = Es Tube Jual (10 KG), 0111 = Es Tube Jual 5 KG,
// 0110 = Es Tube Bonus (10 KG), 0112 = Es Tube Bonus 5 KG.

export interface IsiPesanan {
  label: string;
  qty: number;
}

const LABEL_ITEM: Record<string, string> = {
  "019": "Kantong 10 KG",
  "0111": "Kantong 5 KG",
  "0110": "Bonus 10 KG",
  "0112": "Bonus 5 KG",
};
const URUTAN = ["Kantong 10 KG", "Kantong 5 KG", "Bonus 10 KG", "Bonus 5 KG"];

export function labelItem(itemId: string, nama: string): string {
  return LABEL_ITEM[itemId.trim()] ?? (nama.trim() || itemId.trim());
}

// Gabungkan baris detail yang labelnya sama; urut: kantong 10, kantong 5, bonus, lainnya.
export function ringkasIsi(baris: { itemId: string; nama: string; qty: number }[]): IsiPesanan[] {
  const peta = new Map<string, number>();
  for (const b of baris) {
    if (!(b.qty > 0)) continue;
    const l = labelItem(b.itemId, b.nama);
    peta.set(l, (peta.get(l) ?? 0) + b.qty);
  }
  const rank = (l: string) => {
    const i = URUTAN.indexOf(l);
    return i === -1 ? URUTAN.length : i;
  };
  return [...peta.entries()]
    .map(([label, qty]) => ({ label, qty }))
    .sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label, "id"));
}

export function teksIsi(isi: IsiPesanan[]): string {
  return isi.map((i) => `${i.label} × ${Math.round(i.qty).toLocaleString("id-ID")}`).join(" · ");
}
