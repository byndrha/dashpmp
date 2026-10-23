const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// "Pembaruan data : 08:19:33 WIB | 23 Oktober 2026" -- waktu data kartu dibuat (WIB).
export function teksPembaruan(now: Date = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta", hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(now).map((x) => [x.type, x.value])
  );
  return `Pembaruan data : ${p.hour}:${p.minute}:${p.second} WIB | ${Number(p.day)} ${BULAN[Number(p.month) - 1]} ${p.year}`;
}
