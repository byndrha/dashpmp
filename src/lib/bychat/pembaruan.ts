const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// "Pembaruan data 14:05:09 WIB 22 Okt 2026" -- waktu data kartu dibuat (WIB).
export function teksPembaruan(now: Date = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta", hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(now).map((x) => [x.type, x.value])
  );
  return `Pembaruan data ${p.hour}:${p.minute}:${p.second} WIB ${Number(p.day)} ${BULAN[Number(p.month) - 1]} ${p.year}`;
}
