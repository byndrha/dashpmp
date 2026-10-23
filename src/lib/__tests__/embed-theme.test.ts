import { test } from "node:test";
import assert from "node:assert/strict";
import { temaDariPesan } from "../embed-theme";

test("string JSON appContext dengan theme dark/light", () => {
  assert.equal(temaDariPesan(JSON.stringify({ event: "appContext", data: { theme: "dark", contact: {} } })), "dark");
  assert.equal(temaDariPesan(JSON.stringify({ event: "appContext", data: { theme: "light" } })), "light");
});

test("objek langsung juga diterima", () => {
  assert.equal(temaDariPesan({ event: "appContext", data: { theme: "light" } }), "light");
});

test("event lain, theme tak dikenal, atau bentuk salah diabaikan", () => {
  assert.equal(temaDariPesan(JSON.stringify({ event: "appContextSigned", data: { theme: "dark" } })), null);
  assert.equal(temaDariPesan(JSON.stringify({ event: "appContext", data: { theme: "blue" } })), null);
  assert.equal(temaDariPesan(JSON.stringify({ event: "appContext", data: null })), null);
  assert.equal(temaDariPesan(JSON.stringify({ event: "appContext", data: {} })), null);
  assert.equal(temaDariPesan("bukan json"), null);
  assert.equal(temaDariPesan(null), null);
  assert.equal(temaDariPesan(42), null);
});
