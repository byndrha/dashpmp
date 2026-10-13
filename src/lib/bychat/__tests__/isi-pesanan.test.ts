import { test } from "node:test";
import assert from "node:assert/strict";
import { labelItem, ringkasIsi, teksIsi } from "../isi-pesanan";

test("labelItem: ItemID dikenal → label kantong/bonus", () => {
  assert.equal(labelItem("019", "Es Tube Jual"), "Kantong 10 KG");
  assert.equal(labelItem("0111", "Es Tube Jual 5 KG"), "Kantong 5 KG");
  assert.equal(labelItem("0110", "Es Tube Bonus"), "Bonus 10 KG");
  assert.equal(labelItem("0112", "Es Tube Bonus 5 KG"), "Bonus 5 KG");
});
test("labelItem: ItemID lain memakai nama aslinya", () => {
  assert.equal(labelItem("016", "Es Contoh"), "Es Contoh");
});
test("ringkasIsi: urut kantong 10, kantong 5, bonus; baris sama digabung", () => {
  const r = ringkasIsi([
    { itemId: "0110", nama: "x", qty: 1 },
    { itemId: "019", nama: "x", qty: 20 },
    { itemId: "0111", nama: "x", qty: 5 },
    { itemId: "019", nama: "x", qty: 5 },
  ]);
  assert.deepEqual(r, [
    { label: "Kantong 10 KG", qty: 25 },
    { label: "Kantong 5 KG", qty: 5 },
    { label: "Bonus 10 KG", qty: 1 },
  ]);
});
test("ringkasIsi: qty nol/negatif diabaikan; kosong → []", () => {
  assert.deepEqual(ringkasIsi([{ itemId: "019", nama: "x", qty: 0 }]), []);
  assert.deepEqual(ringkasIsi([]), []);
});
test("teksIsi: format 'label × qty' dipisah titik tengah", () => {
  assert.equal(teksIsi([{ label: "Kantong 10 KG", qty: 25 }, { label: "Bonus 10 KG", qty: 1 }]), "Kantong 10 KG × 25 · Bonus 10 KG × 1");
  assert.equal(teksIsi([]), "");
});
