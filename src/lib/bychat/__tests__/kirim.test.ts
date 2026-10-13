import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { idempotencyKey, bolehKirimUlang, buatPengantar } from "../kirim-util";
import { postIntegrationMessage } from "../client";
import { AppError } from "@/lib/action-result";

test("idempotencyKey: stabil untuk (PT, mitra, tanggal) yang sama", () => {
  assert.equal(idempotencyKey("mkesindo", "01234", "2026-10-13"), idempotencyKey("mkesindo", "01234", "2026-10-13"));
});
test("idempotencyKey: berbeda bila PT, mitra, atau tanggal berbeda", () => {
  const dasar = idempotencyKey("mkesindo", "01234", "2026-10-13");
  assert.notEqual(dasar, idempotencyKey("pmputra", "01234", "2026-10-13"));
  assert.notEqual(dasar, idempotencyKey("mkesindo", "01235", "2026-10-13"));
  assert.notEqual(dasar, idempotencyKey("mkesindo", "01234", "2026-10-14"));
});
test("idempotencyKey: tidak ambigu antar-bidang ('a|bc' vs 'ab|c')", () => {
  assert.notEqual(idempotencyKey("ab", "c", "2026-10-13"), idempotencyKey("a", "bc", "2026-10-13"));
});
test("idempotencyKey: panjang aman (<=80) dan hanya karakter aman", () => {
  const k = idempotencyKey("mkesindo", "01234", "2026-10-13");
  assert.ok(k.length <= 80);
  assert.match(k, /^[A-Za-z0-9_-]+$/);
});

const SEKARANG = new Date("2026-10-13T08:00:00Z");
test("bolehKirimUlang: belum pernah dikirim → boleh", () => {
  assert.equal(bolehKirimUlang(null, SEKARANG, "agent").boleh, true);
});
test("bolehKirimUlang: dikirim <24 jam lalu oleh agen biasa → ditolak dengan alasan", () => {
  const r = bolehKirimUlang({ waktu: new Date("2026-10-13T02:00:00Z"), agenNama: "Budi" }, SEKARANG, "agent");
  assert.equal(r.boleh, false);
  assert.match(r.alasan ?? "", /Budi/);
  assert.match(r.alasan ?? "", /24 jam/);
});
test("bolehKirimUlang: dikirim >24 jam lalu → boleh", () => {
  assert.equal(bolehKirimUlang({ waktu: new Date("2026-10-12T07:00:00Z"), agenNama: "Budi" }, SEKARANG, "agent").boleh, true);
});
test("bolehKirimUlang: administrator boleh override walau <24 jam", () => {
  assert.equal(bolehKirimUlang({ waktu: new Date("2026-10-13T07:30:00Z"), agenNama: "Budi" }, SEKARANG, "administrator").boleh, true);
});
test("buatPengantar: memuat nama mitra, PT, total, jumlah faktur", () => {
  const t = buatPengantar({ mitra: "Toko Maju", pt: "PT Contoh", tanggal: "2026-10-13", total: 1250000, jumlahFaktur: 3 });
  assert.match(t, /Toko Maju/);
  assert.match(t, /PT Contoh/);
  assert.match(t, /Rp 1\.250\.000/);
  assert.match(t, /3 faktur/);
  assert.match(t, /13 Okt 2026/);
});

test("buatPengantar: rekening ditulis sebagai teks yang bisa disalin", () => {
  const t = buatPengantar({
    mitra: "Toko Maju", pt: "PT Contoh", tanggal: "2026-10-13", total: 100000, jumlahFaktur: 1,
    rekening: [{ bank: "Mandiri", nomorRekening: "1234567890123", atasNama: "PT Contoh" }],
  });
  assert.match(t, /Pembayaran dapat ditransfer ke:/);
  assert.match(t, /Mandiri 1234567890123 a\.n\. PT Contoh/);
});
test("buatPengantar: tanpa rekening tidak memuat kalimat transfer", () => {
  const t = buatPengantar({ mitra: "Toko Maju", pt: "PT Contoh", tanggal: "2026-10-13", total: 100000, jumlahFaktur: 1, rekening: [] });
  assert.doesNotMatch(t, /transfer/i);
  assert.match(t, /dikonfirmasi pembayarannya/);
});
test("buatPengantar: rekening tanpa atas nama tetap rapi", () => {
  const t = buatPengantar({ mitra: "A", pt: "B", tanggal: "2026-10-13", total: 1, jumlahFaktur: 1, rekening: [{ bank: "BCA", nomorRekening: "111", atasNama: "" }] });
  assert.match(t, /BCA 111$/m);
});

test("buatPengantar: tautan ikut ditulis bila ada, dan istilah memakai 'faktur'", () => {
  const t = buatPengantar({ mitra: "A", pt: "B", tanggal: "2026-10-13", total: 1, jumlahFaktur: 2, tautan: "https://dash.example/kartu/aB3dE5gH7j" });
  assert.ok(t.includes("https://dash.example/kartu/aB3dE5gH7j"));
  assert.match(t, /2 faktur/);
  assert.doesNotMatch(t, /invoice/i);
});

// ---- klien HTTP terhadap server ByChat tiruan
async function dengan(handler: http.RequestListener, fn: (base: string) => Promise<void>) {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fn(base);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
const form = () => {
  const f = new FormData();
  f.append("inbox_id", "5");
  f.append("phone", "6281234567890");
  return f;
};
const balas = (status: number, body: unknown, headers: Record<string, string> = {}): http.RequestListener => (_req, res) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
};

test("postIntegrationMessage: 201 → hasil + header token terkirim, token tidak bocor di galat", async () => {
  let tokenDiterima = "";
  let path = "";
  await dengan(
    (req, res) => {
      tokenDiterima = String(req.headers["api_access_token"]);
      path = req.url ?? "";
      req.resume();
      balas(201, { data: { conversation_id: 12, contact_id: 3, message_id: 99, created_conversation: true } })(req, res);
    },
    async (base) => {
      const r = await postIntegrationMessage(base, "TOKEN-RAHASIA", 2, form());
      assert.equal(r.conversationId, 12);
      assert.equal(r.messageId, 99);
      assert.equal(r.replayed, false);
    }
  );
  assert.equal(tokenDiterima, "TOKEN-RAHASIA");
  assert.equal(path, "/api/v1/accounts/2/kanban/integration_messages");
});
test("postIntegrationMessage: 200 + replayed:true dikenali", async () => {
  await dengan(balas(200, { replayed: true, data: { conversation_id: 12, contact_id: 3, message_id: 99 } }), async (base) => {
    const r = await postIntegrationMessage(base, "t", 2, form());
    assert.equal(r.replayed, true);
  });
});
for (const [status, cocok] of [
  [401, /ditolak/i],
  [403, /anggota inbox/i],
  [404, /tidak ditemukan/i],
  [409, /sedang diproses/i],
  [422, /nomor tidak valid/i],
  [500, /status 500/],
] as const) {
  test(`postIntegrationMessage: ${status} → AppError Indonesia`, async () => {
    await dengan(balas(status, { error: status === 422 ? "nomor tidak valid" : "x" }), async (base) => {
      await assert.rejects(postIntegrationMessage(base, "TOKEN-RAHASIA", 2, form()), (e: unknown) => {
        assert.ok(e instanceof AppError);
        assert.match((e as Error).message, cocok);
        assert.doesNotMatch((e as Error).message, /TOKEN-RAHASIA/);
        return true;
      });
    });
  });
}
test("postIntegrationMessage: 429 memuat Retry-After", async () => {
  await dengan(balas(429, { error: "slow" }, { "retry-after": "17" }), async (base) => {
    await assert.rejects(postIntegrationMessage(base, "t", 2, form()), (e: unknown) => {
      assert.match((e as Error).message, /17 detik/);
      return true;
    });
  });
});
test("postIntegrationMessage: server tidak terjangkau → AppError, bukan crash", async () => {
  await assert.rejects(postIntegrationMessage("http://127.0.0.1:1", "t", 2, form()), (e: unknown) => e instanceof AppError);
});
