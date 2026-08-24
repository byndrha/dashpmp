"use client";

// Browser-only module (navigator.bluetooth / navigator.usb) — never
// imported from a Server Component or server action. Both transports are
// normalized behind ThermalPrinterConnection so callers (the poller, the
// manual reprint flow) never branch on which one is active.
export interface ThermalPrinterConnection {
  send(bytes: Uint8Array): Promise<void>;
  disconnect(): void;
}

// Iware C5813 and most ESC/POS clones expose a single "Serial Port
// Profile"-style GATT service for raw byte writes — this UUID is the
// widely-used generic serial service most budget thermal printers (Iware,
// Goojprt, and rebadged clones of the same reference design) ship with.
// Confirmed against the printer live before shipping this to production —
// if pairing succeeds but no matching service/characteristic is found,
// surface a clear "printer tidak dikenali" error rather than a silent hang.
const PRINTER_SERVICE_UUID = "000018f0-0000-1000-8000-00805f9b34fb";
const PRINTER_CHARACTERISTIC_UUID = "00002af1-0000-1000-8000-00805f9b34fb";

// Bluetooth writes are chunked — most GATT characteristics cap a single
// writeValue at 20 bytes (BLE's default ATT MTU), so a full receipt (easily
// several hundred bytes) must be split and sent sequentially, awaiting each
// write before starting the next (a GATT characteristic has no internal
// queue — firing writes concurrently silently drops all but the last one).
const BLE_CHUNK_SIZE = 20;

export async function connectViaBluetooth(): Promise<ThermalPrinterConnection> {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [PRINTER_SERVICE_UUID] }],
  });
  const server = await device.gatt?.connect();
  if (!server) throw new Error("Gagal membuka koneksi GATT ke printer.");
  const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
  const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);

  return {
    async send(bytes: Uint8Array) {
      for (let offset = 0; offset < bytes.length; offset += BLE_CHUNK_SIZE) {
        await characteristic.writeValueWithoutResponse(new Uint8Array(bytes.slice(offset, offset + BLE_CHUNK_SIZE)));
      }
    },
    disconnect() {
      device.gatt?.disconnect();
    },
  };
}

export async function connectViaUsb(): Promise<ThermalPrinterConnection> {
  const device = await navigator.usb.requestDevice({ filters: [] });
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  const iface = device.configuration!.interfaces[0];
  await device.claimInterface(iface.interfaceNumber);
  // The OUT endpoint is whichever bulk-transfer endpoint isn't the IN
  // direction — thermal printers expose exactly one of each on their
  // printer-class interface.
  const outEndpoint = iface.alternate.endpoints.find((e) => e.direction === "out");
  if (!outEndpoint) throw new Error("Printer USB ini tidak punya endpoint OUT yang dikenali.");

  return {
    async send(bytes: Uint8Array) {
      await device.transferOut(outEndpoint.endpointNumber, new Uint8Array(bytes));
    },
    disconnect() {
      device.close();
    },
  };
}

// Called on every /mkesindo/delivery page load — restores a previously-
// authorized device with NO new permission prompt (browser requirement:
// only a real user gesture, e.g. the explicit "Hubungkan Printer" click,
// can trigger requestDevice's picker). Returns null if nothing was ever
// authorized, or if the previously-authorized device isn't reachable right
// now (powered off, out of range) — the caller falls back to showing the
// "Hubungkan Printer" control either way.
export async function reconnectPersisted(): Promise<ThermalPrinterConnection | null> {
  try {
    const bleDevices = await navigator.bluetooth.getDevices();
    for (const device of bleDevices) {
      try {
        const server = await device.gatt?.connect();
        if (!server) continue;
        const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
        const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);
        return {
          async send(bytes: Uint8Array) {
            for (let offset = 0; offset < bytes.length; offset += BLE_CHUNK_SIZE) {
              await characteristic.writeValueWithoutResponse(new Uint8Array(bytes.slice(offset, offset + BLE_CHUNK_SIZE)));
            }
          },
          disconnect() {
            device.gatt?.disconnect();
          },
        };
      } catch {
        continue;
      }
    }
  } catch {
    // navigator.bluetooth.getDevices() itself can throw if the permission
    // backend isn't available (e.g. desktop Chrome with the flag disabled)
    // — fall through to the USB attempt below rather than surfacing this.
  }

  try {
    const usbDevices = await navigator.usb.getDevices();
    const device = usbDevices[0];
    if (!device) return null;
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    const iface = device.configuration!.interfaces[0];
    await device.claimInterface(iface.interfaceNumber);
    const outEndpoint = iface.alternate.endpoints.find((e) => e.direction === "out");
    if (!outEndpoint) return null;
    return {
      async send(bytes: Uint8Array) {
        await device.transferOut(outEndpoint.endpointNumber, new Uint8Array(bytes));
      },
      disconnect() {
        device.close();
      },
    };
  } catch {
    return null;
  }
}
