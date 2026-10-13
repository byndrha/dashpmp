import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { normalizeBaseUrl, ujiKoneksi } from "../client";
import { AppError } from "@/lib/action-result";

async function dengan(handler: http.RequestListener, fn: (base: string) => Promise<void>) {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const profil = (accounts: unknown[]): http.RequestListener => (req, res) => {
  if (req.headers["api_access_token"] !== "TOKEN-OK") {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end("{}");
  }
  res.writeHead(200, { "content-type": "application/json" });
  if (req.url === "/api/v1/profile") return res.end(JSON.stringify({ name: "Penagihan Uji", accounts }));
  if (/\/api\/v1\/accounts\/\d+\/inboxes$/.test(req.url ?? "")) {
    return res.end(JSON.stringify({ payload: [{ id: 7, name: "WA Penagihan", channel_type: "Channel::Api" }, { id: 8, name: "Lain", channel_type: "Channel::Email" }] }));
  }
  res.end("{}");
};

test("ujiKoneksi: token sah, akun cocok, peran agen → ok + daftar inbox", async () => {
  await dengan(profil([{ id: 2, name: "PT Uji", role: "agent" }]), async (base) => {
    const r = await ujiKoneksi(base, "TOKEN-OK", 2);
    assert.equal(r.ok, true);
    assert.equal(r.namaAkun, "PT Uji");
    assert.equal(r.peran, "agent");
    assert.deepEqual(r.inbox.map((i) => i.id), [7, 8]);
  });
});
test("ujiKoneksi: ID akun yang diketik bukan milik token → ditolak (cegah PT tertukar)", async () => {
  await dengan(profil([{ id: 2, name: "PT Uji", role: "agent" }]), async (base) => {
    const r = await ujiKoneksi(base, "TOKEN-OK", 3);
    assert.equal(r.ok, false);
    assert.match(r.pesan, /tidak punya akses ke akun ByChat ID 3/);
    assert.deepEqual(r.inbox, []);
  });
});
test("ujiKoneksi: token berperan administrator → ditolak (hak minimum)", async () => {
  await dengan(profil([{ id: 2, name: "PT Uji", role: "administrator" }]), async (base) => {
    const r = await ujiKoneksi(base, "TOKEN-OK", 2);
    assert.equal(r.ok, false);
    assert.match(r.pesan, /administrator/i);
    assert.deepEqual(r.inbox, []);
  });
});
test("ujiKoneksi: token ditolak server (401) → AppError tanpa membocorkan token", async () => {
  await dengan(profil([]), async (base) => {
    await assert.rejects(ujiKoneksi(base, "TOKEN-SALAH", 2), (e: unknown) => {
      assert.ok(e instanceof AppError);
      assert.match((e as Error).message, /ditolak/i);
      assert.doesNotMatch((e as Error).message, /TOKEN-SALAH/);
      return true;
    });
  });
});
test("normalizeBaseUrl: https wajib, http hanya untuk localhost, tanpa kredensial", () => {
  assert.equal(normalizeBaseUrl("https://chat.byndrha.id/"), "https://chat.byndrha.id");
  assert.equal(normalizeBaseUrl("https://chat.byndrha.id/api/v1"), "https://chat.byndrha.id");
  assert.equal(normalizeBaseUrl("http://localhost:3000"), "http://localhost:3000");
  assert.throws(() => normalizeBaseUrl("http://chat.byndrha.id"), AppError);
  assert.throws(() => normalizeBaseUrl("ftp://x"), AppError);
  assert.throws(() => normalizeBaseUrl("https://user:pw@chat.byndrha.id"), AppError);
  assert.throws(() => normalizeBaseUrl("bukan url"), AppError);
});
