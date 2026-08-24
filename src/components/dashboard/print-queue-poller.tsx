"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Printer, Usb, Bluetooth } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePrinterConnection } from "@/lib/thermal-printer/use-printer-connection";
import { buildReceiptBytes } from "@/lib/thermal-printer/receipt-builder";
import {
  getPendingPrintQueueAction,
  markPrintQueueDoneAction,
  getThermalReceiptDataAction,
} from "@/app/mkesindo/(dashboard)/delivery/actions";

const POLL_INTERVAL_MS = 4000;
const PRINT_GAP_MS = 5000;

// Mounted once, at the top of /mkesindo/delivery — NOT inside
// RouteValidationDialog — so it keeps draining the queue regardless of
// which Jadwal's dialog is open or closed, and regardless of whether the
// Selesai Muat that created a job happened on THIS page or on produksi-app.
export function PrintQueuePoller() {
  const { status, connection, connectBluetooth, connectUsb } = usePrinterConnection();
  const draining = useRef(false);
  // usePrinterConnection now returns `connection` as state (see Task 10's
  // hook), so it's already fresh on every render — this ref just lets the
  // setInterval closure below (created once, in an effect with an empty dep
  // array) read the LATEST connection without needing to be recreated every
  // time the user connects/disconnects a printer.
  const connectionRef = useRef(connection);
  // Synced in an effect, not during render — the repo's react-hooks/refs
  // lint rule (the same one that made Task 10's usePrinterConnection switch
  // `connection` to state internally) rejects writing a ref's `.current`
  // directly in the render body.
  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  useEffect(() => {
    const interval = setInterval(async () => {
      // Guard against two overlapping poll ticks both starting a drain
      // cycle: if a previous tick's drain (including its inter-print
      // PRINT_GAP_MS waits) is still running when this tick fires, skip
      // this tick entirely rather than starting a second, concurrent drain
      // that could race the first one for the same jobs.
      if (draining.current) return;
      const conn = connectionRef.current;
      if (!conn) return;

      // Set the flag synchronously, before the first await, so a second
      // poll tick firing while getPendingPrintQueueAction() is still in
      // flight can't slip past the check above and start a concurrent
      // drain of the same jobs.
      draining.current = true;
      try {
        const jobsResult = await getPendingPrintQueueAction();
        if (!jobsResult.success || jobsResult.data.length === 0) return;

        for (let i = 0; i < jobsResult.data.length; i++) {
          const job = jobsResult.data[i];
          const dataResult = await getThermalReceiptDataAction(job.salesInvoiceId);
          if (!dataResult.success) {
            toast.error(`Gagal ambil data SI untuk struk: ${dataResult.error}`);
            break;
          }
          try {
            await conn.send(buildReceiptBytes(dataResult.data));
          } catch (err) {
            toast.error(`Cetak gagal — periksa printer (kertas/koneksi). ${err instanceof Error ? err.message : ""}`);
            break;
          }
          const doneResult = await markPrintQueueDoneAction(job.printQueueId);
          if (!doneResult.success) {
            // The physical print already happened, but the DB write that
            // marks it done failed — the job will look "Pending" again on
            // the next poll tick and get reprinted. That's an acceptable,
            // rare edge case (transient DB error right after a successful
            // send); we still stop the batch so we don't compound it by
            // racing further prints against an unreliable DB.
            toast.error(`Cetak berhasil tapi gagal update status antrian: ${doneResult.error}`);
            break;
          }
          // Gap AFTER each successful print, but only if there's a next job
          // to process — never wait after the last job in the batch. Gives
          // the printer's internal buffer time to flush the previous receipt
          // before the next job's bytes start arriving.
          if (i < jobsResult.data.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, PRINT_GAP_MS));
          }
        }
      } finally {
        draining.current = false;
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  if (status === "connected") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Printer className="size-3.5 text-primary" /> Printer tersambung
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <p className="text-xs text-muted-foreground">Printer belum tersambung</p>
      <Button size="sm" variant="outline" className="gap-1.5" disabled={status === "connecting"} onClick={connectBluetooth}>
        <Bluetooth className="size-3.5" /> Bluetooth
      </Button>
      <Button size="sm" variant="outline" className="gap-1.5" disabled={status === "connecting"} onClick={connectUsb}>
        <Usb className="size-3.5" /> USB
      </Button>
    </div>
  );
}
