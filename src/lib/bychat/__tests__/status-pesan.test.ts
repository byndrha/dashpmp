import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ambilStatusPesan } from "../client";

async function denganServer(status: number, body: unknown, fn: (url: string) => Promise<void>) {
  const srv = http.createServer((_req, res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  try {
    await fn(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`);
  } finally {
    srv.close();
  }
}

test("ambilStatusPesan: failed + external_error dibaca; pesan private diabaikan", async () => {
  const payload = [
    { id: 10, private: true, status: "sent" },
    { id: 11, status: "failed", content_attributes: { external_error: "404 Not Found" } },
  ];
  await denganServer(200, { payload }, async (u) => {
    assert.deepEqual(await ambilStatusPesan(u, "t", 1, 5, 11), { status: "failed", galat: "404 Not Found" });
    assert.equal((await ambilStatusPesan(u, "t", 1, 5, 10)).status, "tidak_ditemukan");
  });
});
test("ambilStatusPesan: status numerik (enum 0-3) dan string", async () => {
  await denganServer(200, { payload: [{ id: 1, status: 1 }, { id: 2, status: "read" }, { id: 3, status: 0 }] }, async (u) => {
    assert.equal((await ambilStatusPesan(u, "t", 1, 5, 1)).status, "delivered");
    assert.equal((await ambilStatusPesan(u, "t", 1, 5, 2)).status, "read");
    assert.equal((await ambilStatusPesan(u, "t", 1, 5, 3)).status, "sent");
  });
});
test("ambilStatusPesan: 401 → AppError", async () => {
  await denganServer(401, {}, async (u) => {
    await assert.rejects(() => ambilStatusPesan(u, "t", 1, 5, 1), /tidak boleh membaca/);
  });
});
