"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Factory,
  Loader2,
  Lock,
  ReceiptText,
  Snowflake,
  Truck,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Kolom isian berikon (ikon di kiri, aksi opsional di kanan).
const KELAS_ISIAN =
  "h-11 w-full rounded-xl border bg-background pl-10 pr-3 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Always safe to default to "/" — middleware.ts dispatches bare "/" by
  // accountScope right after login (mkesindo -> /mkesindo, pmputra ->
  // /pmputra, cross-PT accounts -> /grup), so this doesn't need its own
  // role check.
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [lihatSandi, setLihatSandi] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Naik setiap kali gagal, jadi kotak galat dipasang ulang dan animasinya
  // terulang walau pesannya sama.
  const [percobaan, setPercobaan] = useState(0);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signIn("credentials", {
      username: username.trim(),
      password,
      redirect: false,
    });

    if (result?.error) {
      setLoading(false);
      setPercobaan((n) => n + 1);
      // Sengaja tidak membedakan "salah" vs "terkunci" (OWASP: jangan
      // membocorkan keberadaan akun) — penguncian 15 menit setelah 5 kali
      // gagal ada di recordFailedLogin (lib/queries/akun.ts).
      setError(
        "Username atau password salah. Setelah 5 kali gagal, akun dikunci sementara selama 15 menit."
      );
      return;
    }

    // Tetap dalam keadaan memuat sampai halaman tujuan terbuka, supaya
    // tombol tidak bisa ditekan dua kali.
    router.push(callbackUrl);
    router.refresh();
  }

  function cekCapsLock(e: React.KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState?.("CapsLock") ?? false);
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-7 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 motion-safe:ease-out">
      {/* Logo hanya di HP — di layar lebar sudah ada di panel merek. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand asset, no next/image usage elsewhere in this codebase */}
      <img
        src="/brand/logo-pmp-group.png"
        alt="PMP Group"
        className="h-12 w-auto self-start lg:hidden dark:brightness-0 dark:invert"
      />
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Selamat datang kembali</h1>
        <p className="text-sm text-muted-foreground">Masuk dengan akun yang terdaftar untuk membuka dashboard.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="username">Username</Label>
          <div className="relative">
            <User className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              required
              placeholder="nama.pengguna"
              aria-invalid={error ? true : undefined}
              className={KELAS_ISIAN}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="password"
              type={lihatSandi ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={cekCapsLock}
              onKeyUp={cekCapsLock}
              onBlur={() => setCapsLock(false)}
              autoComplete="current-password"
              required
              placeholder="••••••••"
              aria-invalid={error ? true : undefined}
              className={cn(KELAS_ISIAN, "pr-11")}
            />
            <button
              type="button"
              onClick={() => setLihatSandi((v) => !v)}
              className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={lihatSandi ? "Sembunyikan password" : "Tampilkan password"}
              aria-pressed={lihatSandi}
            >
              {lihatSandi ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {capsLock && (
            <p className="text-xs font-medium text-warning motion-safe:animate-in motion-safe:fade-in-0">
              Caps Lock sedang aktif.
            </p>
          )}
        </div>

        {error && (
          <div
            key={percobaan}
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button
          type="submit"
          disabled={loading || !username.trim() || !password}
          className="group/masuk mt-1 h-11 w-full gap-2 rounded-xl text-sm"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Memproses...
            </>
          ) : (
            <>
              Masuk
              <ArrowRight className="size-4 transition-transform duration-200 motion-safe:group-hover/masuk:translate-x-0.5" />
            </>
          )}
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        Lupa password atau belum punya akun? Hubungi administrator PMP Group.
      </p>
    </div>
  );
}

const SOROTAN = [
  { icon: ReceiptText, judul: "Penjualan & piutang", isi: "Omzet harian, umur piutang, dan pelunasan per mitra." },
  { icon: Truck, judul: "Pemesanan & pengiriman", isi: "Jadwal armada, DO, dan faktur dalam satu alur." },
  { icon: Factory, judul: "Produksi", isi: "Stok cold storage, kualitas, dan aktivitas tiap shift." },
];

// Panel merek (layar lebar). Pola kristal (.crystal-field) bergerak sangat
// pelan sebagai latar — hanya bila pengguna tidak meminta gerak dikurangi.
function PanelMerek() {
  return (
    <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
      <div className="crystal-field pointer-events-none absolute -inset-16 opacity-60 mix-blend-overlay motion-safe:animate-[spin_240s_linear_infinite]" />
      <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-black/10 blur-3xl" />
      <Snowflake className="pointer-events-none absolute right-16 top-1/3 size-40 opacity-[0.07] motion-safe:animate-[spin_90s_linear_infinite]" />

      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand asset, no next/image usage elsewhere in this codebase */}
      <img src="/brand/logo-pmp-group.png" alt="PMP Group" className="relative h-14 w-auto self-start brightness-0 invert" />

      <div className="relative flex max-w-md flex-col gap-8">
        <div className="flex flex-col gap-3">
          <h2 className="font-display text-3xl font-semibold leading-tight tracking-tight">
            Satu dashboard untuk seluruh operasional PMP Group.
          </h2>
          <p className="text-sm text-primary-foreground/80">
            Es Kristal dan Es Balok — dari pesanan masuk sampai faktur terbit, dipantau dari satu tempat.
          </p>
        </div>
        <ul className="flex flex-col gap-4">
          {SOROTAN.map(({ icon: Icon, judul, isi }, i) => (
            <li
              key={judul}
              className="flex items-start gap-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-2 motion-safe:duration-500 motion-safe:fill-mode-backwards"
              style={{ animationDelay: `${200 + i * 100}ms` }}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <Icon className="size-4" />
              </span>
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold">{judul}</p>
                <p className="text-sm text-primary-foreground/75">{isi}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Sengaja tanpa daftar PT: halaman ini publik dan dipakai bersama
          tenant lain di domain yang sama (lihat lib/tenant.ts). */}
      <p className="relative text-xs text-primary-foreground/70">© {new Date().getFullYear()} PMP Group</p>
    </aside>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh flex-1 bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <PanelMerek />
      <main className="crystal-field flex items-center justify-center px-6 py-10 lg:bg-none">
        <Suspense>
          <LoginForm />
        </Suspense>
      </main>
    </div>
  );
}
