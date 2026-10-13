import { test } from "node:test";
import assert from "node:assert/strict";
import { adalahPermintaanOptOut, bacaPesanMasuk, hitungTandaTangan, verifikasiTandaTangan } from "../webhook-util";

const NOW = new Date("2026-10-14T03:00:00Z");
const ts = String(Math.floor(NOW.getTime() / 1000));

test("tanda tangan: benar lolos; body diubah / secret salah / timestamp basi / kosong ditolak", () => {
  const body = '{"a":1}';
  const sig = hitungTandaTangan("rahasia", ts, body);
  const base = { secret: "rahasia", timestamp: ts, tandaTangan: sig, bodyMentah: body, sekarang: NOW };
  assert.equal(verifikasiTandaTangan(base), true);
  assert.equal(verifikasiTandaTangan({ ...base, bodyMentah: '{"a":2}' }), false);
  assert.equal(verifikasiTandaTangan({ ...base, secret: "lain" }), false);
  assert.equal(verifikasiTandaTangan({ ...base, sekarang: new Date(NOW.getTime() + 6 * 60000) }), false);
  assert.equal(verifikasiTandaTangan({ ...base, tandaTangan: null }), false);
  assert.equal(verifikasiTandaTangan({ ...base, timestamp: "abc" }), false);
  assert.equal(verifikasiTandaTangan({ ...base, secret: "" }), false);
});

test("opt-out: frasa tegas pendek → ya", () => {
  for (const t of ["Berhenti", "STOP", "stop kirim", "tolong berhenti ya", "Jangan kirim lagi", "jangan tagih saya!", "unsubscribe"]) {
    assert.equal(adalahPermintaanOptOut(t), true, t);
  }
});
test("opt-out: ambigu, panjang, atau bernegasi → tidak", () => {
  for (const t of ["sudah", "nanti ya", "oke transfer besok", "jangan stop dulu", "saya tidak berhenti beli", "", "terima kasih pak, besok saya transfer dan nanti stop kalau lunas"]) {
    assert.equal(adalahPermintaanOptOut(t), false, t);
  }
  assert.equal(adalahPermintaanOptOut(null), false);
});

const dasar = {
  event: "message_created", message_type: "incoming", content: "stop", account: { id: 3 },
  conversation: { id: 77, meta: { sender: { phone_number: "+6281234567890" } } },
};
test("bacaPesanMasuk: incoming → nomor kanonik", () => {
  const r = bacaPesanMasuk(dasar);
  assert.deepEqual(r, { accountId: 3, conversationId: 77, nomor: "6281234567890", teks: "stop" });
});
test("bacaPesanMasuk: outgoing / private / event lain / tanpa nomor", () => {
  assert.equal(bacaPesanMasuk({ ...dasar, message_type: "outgoing" }), null);
  assert.equal(bacaPesanMasuk({ ...dasar, private: true }), null);
  assert.equal(bacaPesanMasuk({ ...dasar, event: "message_updated" }), null);
  assert.equal(bacaPesanMasuk({ ...dasar, account: {} }), null);
  assert.equal(bacaPesanMasuk({ ...dasar, conversation: { id: 1, meta: { sender: {} } } })?.nomor, null);
});
