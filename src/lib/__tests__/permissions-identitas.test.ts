import { test } from "node:test";
import assert from "node:assert/strict";
import { aksesIdentitasMitra, fullPermissionMap, SPECIAL_PERMISSION_KEYS } from "../permissions";

test("Super Admin selalu boleh lihat & ubah identitas mitra", () => {
  assert.deepEqual(aksesIdentitasMitra({ isSuperAdmin: true, accountScope: "mkesindo", permissions: {} }), { lihat: true, ubah: true });
});

test("Direktur selalu boleh lihat & ubah walau permissions kosong", () => {
  assert.deepEqual(aksesIdentitasMitra({ isSuperAdmin: false, accountScope: "direktur", permissions: {} }), { lihat: true, ubah: true });
});

test("Peran dengan mitra_identitas lihat saja", () => {
  assert.deepEqual(
    aksesIdentitasMitra({
      isSuperAdmin: false,
      accountScope: "mkesindo",
      permissions: { mitra_identitas: { canView: true, canEdit: false } },
    }),
    { lihat: true, ubah: false }
  );
});

test("Peran tanpa kunci mitra_identitas tidak boleh apa pun", () => {
  assert.deepEqual(
    aksesIdentitasMitra({ isSuperAdmin: false, accountScope: "mkesindo", permissions: { mitra: { canView: true, canEdit: true } } }),
    { lihat: false, ubah: false }
  );
});

test("permissions undefined (JWT lama) diperlakukan tanpa akses", () => {
  assert.deepEqual(aksesIdentitasMitra({ isSuperAdmin: false, accountScope: "mkesindo" }), { lihat: false, ubah: false });
});

test("fullPermissionMap menyertakan semua kunci izin khusus", () => {
  const map = fullPermissionMap();
  for (const key of SPECIAL_PERMISSION_KEYS) {
    assert.deepEqual(map[key], { canView: true, canEdit: true });
  }
});
