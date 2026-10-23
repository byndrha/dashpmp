import { test } from "node:test";
import assert from "node:assert/strict";
import { asalPesanDiterima, deteksiEmbedHost } from "../embed-host";

const top = {} as { parent: unknown; ReactNativeWebView?: { postMessage?: unknown } };
top.parent = top;

test("deteksi mode host", () => {
  assert.equal(deteksiEmbedHost(top), "mandiri");
  assert.equal(deteksiEmbedHost({ parent: {} }), "iframe");
  assert.equal(deteksiEmbedHost({ parent: {}, ReactNativeWebView: { postMessage: () => {} } }), "webview");
  assert.equal(deteksiEmbedHost({ parent: {}, ReactNativeWebView: {} }), "iframe");
});

test("origin: iframe hanya allowedOrigins, webview hanya origin sendiri", () => {
  const allow = ["https://chat.byndrha.id"];
  const own = "https://dash.pabrikespmp.com";
  assert.equal(asalPesanDiterima("iframe", "https://chat.byndrha.id", allow, own), true);
  assert.equal(asalPesanDiterima("iframe", own, allow, own), false);
  assert.equal(asalPesanDiterima("iframe", "", allow, own), false);
  assert.equal(asalPesanDiterima("webview", own, allow, own), true);
  assert.equal(asalPesanDiterima("webview", "https://evil.example", allow, own), false);
  assert.equal(asalPesanDiterima("webview", "https://chat.byndrha.id", allow, own), false);
  assert.equal(asalPesanDiterima("mandiri", own, allow, own), false);
});
