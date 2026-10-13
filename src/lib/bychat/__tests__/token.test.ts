import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { verifyContextToken, TokenError } from "../token";

const SECRET = "rahasia-uji-yang-panjangnya-lebih-dari-32-karakter!!";
const AUD = "https://dash.example.test";
const enc = new TextEncoder().encode(SECRET);

type Over = Record<string, unknown>;
async function bikin(over: Over = {}, opt: { secret?: string; alg?: string; exp?: string | number; iat?: number; iss?: string | null; aud?: string | null } = {}) {
  const payload: Over = {
    account_id: 2,
    conversation_id: 77,
    inbox_id: 5,
    agent: { id: 9, name: "Agen Tagih", email: "tagih@pt.test", role: "agent" },
    contact: { id: 31, name: "Toko Maju", phone_number: "+6281234567890", identifier: "6281234567890@s.whatsapp.net" },
    ...over,
  };
  let jwt = new SignJWT(payload).setProtectedHeader({ alg: opt.alg ?? "HS256" }).setSubject("9").setJti("jti-1");
  const iat = opt.iat ?? Math.floor(Date.now() / 1000);
  jwt = jwt.setIssuedAt(iat);
  if (opt.iss !== null) jwt = jwt.setIssuer(opt.iss ?? "bychat");
  if (opt.aud !== null) jwt = jwt.setAudience(opt.aud ?? AUD);
  jwt = jwt.setExpirationTime(opt.exp ?? iat + 60);
  return jwt.sign(opt.secret ? new TextEncoder().encode(opt.secret) : enc);
}
const opts = { secret: SECRET, audience: AUD };

async function tolak(token: string, o = opts, kode?: string) {
  await assert.rejects(verifyContextToken(token, o), (e: unknown) => {
    assert.ok(e instanceof TokenError, "harus TokenError");
    if (kode) assert.equal((e as TokenError).kode, kode);
    return true;
  });
}

test("token valid: klaim terbaca dengan benar", async () => {
  const c = await verifyContextToken(await bikin(), opts);
  assert.equal(c.accountId, 2);
  assert.equal(c.conversationId, 77);
  assert.equal(c.inboxId, 5);
  assert.equal(c.agent.email, "tagih@pt.test");
  assert.equal(c.agent.role, "agent");
  assert.equal(c.contact.phoneNumber, "+6281234567890");
  assert.equal(c.contact.identifier, "6281234567890@s.whatsapp.net");
});
test("account_id string numerik diterima sebagai angka", async () => {
  const c = await verifyContextToken(await bikin({ account_id: "3" }), opts);
  assert.equal(c.accountId, 3);
});
test("token palsu: rahasia berbeda ditolak", async () => {
  await tolak(await bikin({}, { secret: "rahasia-penyerang-yang-juga-lebih-dari-32-karakter" }), opts, "tidak_valid");
});
test("token dimodifikasi (payload diganti) ditolak", async () => {
  const t = await bikin();
  const [h, , s] = t.split(".");
  const palsu = Buffer.from(JSON.stringify({ account_id: 99, iss: "bychat", aud: AUD, exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
  await tolak(`${h}.${palsu}.${s}`, opts, "tidak_valid");
});
test("token kedaluwarsa ditolak dengan kode 'kedaluwarsa'", async () => {
  const lalu = Math.floor(Date.now() / 1000) - 600;
  await tolak(await bikin({}, { iat: lalu, exp: lalu + 60 }), opts, "kedaluwarsa");
});
test("audience salah ditolak", async () => {
  await tolak(await bikin({}, { aud: "https://situs-lain.test" }), opts, "tidak_valid");
});
test("audience hilang ditolak", async () => {
  await tolak(await bikin({}, { aud: null }), opts, "tidak_valid");
});
test("issuer salah/hilang ditolak", async () => {
  await tolak(await bikin({}, { iss: "penyerang" }), opts, "tidak_valid");
  await tolak(await bikin({}, { iss: null }), opts, "tidak_valid");
});
test("algoritma selain HS256 ditolak (HS512)", async () => {
  await tolak(await bikin({}, { alg: "HS512" }), opts, "tidak_valid");
});
test("tanpa kedaluwarsa (exp hilang) ditolak", async () => {
  const t = await new SignJWT({ account_id: 2, agent: {}, contact: {} })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("bychat").setAudience(AUD).setIssuedAt().sign(enc);
  await tolak(t, opts, "tidak_valid");
});
test("umur token terlalu panjang (>300 dtk) ditolak walau belum kedaluwarsa", async () => {
  const sekarang = Math.floor(Date.now() / 1000);
  await tolak(await bikin({}, { iat: sekarang, exp: sekarang + 3600 }), opts, "tidak_valid");
});
test("account_id hilang atau bukan angka ditolak", async () => {
  await tolak(await bikin({ account_id: undefined }), opts, "tidak_valid");
  await tolak(await bikin({ account_id: "abc" }), opts, "tidak_valid");
});
test("string sampah / kosong ditolak", async () => {
  await tolak("", opts, "tidak_valid");
  await tolak("bukan.jwt.sama-sekali", opts, "tidak_valid");
});
test("rahasia tidak dikonfigurasi atau terlalu pendek → galat konfigurasi (gagal tertutup)", async () => {
  await tolak(await bikin(), { secret: "", audience: AUD }, "konfigurasi");
  await tolak(await bikin(), { secret: "pendek", audience: AUD }, "konfigurasi");
});
test("kontak tanpa nomor (LID) → phoneNumber null, token tetap sah", async () => {
  const c = await verifyContextToken(await bikin({ contact: { id: 1, name: "X", phone_number: null, identifier: "123@lid" } }), opts);
  assert.equal(c.contact.phoneNumber, null);
});
