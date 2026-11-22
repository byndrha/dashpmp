// Animasi masuk halaman: template.tsx dipasang ulang setiap pindah halaman
// (berbeda dengan layout.tsx), jadi isi halaman baru muncul dengan fade +
// naik 4px selama 300 ms ease-out (NN/g: perubahan layar besar 200–300 ms).
// Hanya untuk pengguna yang tidak meminta gerak dikurangi (motion-safe).
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col gap-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300 motion-safe:ease-out">
      {children}
    </div>
  );
}
