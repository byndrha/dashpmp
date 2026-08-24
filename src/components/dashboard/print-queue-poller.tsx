"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Printer, Usb, Bluetooth } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePrinterConnection } from "@/lib/thermal-printer/use-printer-connection";
import { buildReceiptBytes } from "@/lib/thermal-printer/receipt-builder";
import {
  getPendingPrintQueueAction,
  markPrintQueueDoneAction,
  getThermalReceiptDataAction,
  claimPrintQueueJobAction,
  incrementPrintQueueFailCountAction,
  markPrintQueueErrorAction,
  revertPrintQueueJobToPendingAction,
  getPrintFormatSettingsAction,
} from "@/app/mkesindo/(dashboard)/delivery/actions";

// A job that fails this many times in a row is marked 'Error' (a terminal
// state, excluded from getPendingPrintQueue's WHERE Status = 'Pending') and
// skipped rather than left to wedge the FIFO queue for everyone forever.
const MAX_FAIL_COUNT = 3;

const POLL_INTERVAL_MS = 4000;
const PRINT_GAP_MS = 5000;

// Dispatched by any component that just enqueued a job (e.g. the manual
// reprint icon in route-validation-dialog.tsx) so it prints immediately
// instead of waiting up to POLL_INTERVAL_MS for the next scheduled tick.
// A plain window CustomEvent, not React context/props, because the poller
// and the dialog that enqueues manual reprints are mounted as unrelated
// siblings under pengiriman-board.tsx with no convenient shared ancestor to
// thread a callback through.
const POLL_NOW_EVENT = "mkesindo:print-queue-poll-now";

export function triggerPrintQueuePollNow(): void {
  window.dispatchEvent(new Event(POLL_NOW_EVENT));
}

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

  // Wrapped in useCallback (stable identity, empty deps — reads connection
  // via the ref like the rest of this component already does) so both the
  // interval below and the "poll now" event listener call the exact same
  // drain logic — one code path, not two.
  // warnIfDisconnected: the automatic interval tick stays silent when no
  // printer is connected yet (that's the normal state before staff opens
  // "Hubungkan Printer" for the day) — but a manual reprint click deserves
  // explicit feedback instead of silently doing nothing, since the user
  // just watched "SI ditambahkan ke antrian cetak." and is expecting it to
  // print right away.
  const drainQueue = useCallback(async (warnIfDisconnected = false) => {
    // Guard against two overlapping drain cycles — from an interval tick,
    // a "poll now" event, or one of each firing close together: if a
    // previous drain (including its inter-print PRINT_GAP_MS waits) is
    // still running, skip this call entirely rather than starting a
    // second, concurrent drain that could race the first one for the same
    // jobs.
    if (draining.current) return;

    // Set the flag synchronously, before the first await, so a second
    // trigger firing while getPendingPrintQueueAction() is still in
    // flight can't slip past the check above and start a concurrent
    // drain of the same jobs.
    draining.current = true;
    try {
      const jobsResult = await getPendingPrintQueueAction();
      if (!jobsResult.success || jobsResult.data.length === 0) return;

      const conn = connectionRef.current;
      if (!conn) {
        if (warnIfDisconnected) {
          toast.error("Printer belum tersambung — hubungkan Bluetooth/USB dahulu untuk mencetak SI.");
        }
        return;
      }

      const settingsResult = await getPrintFormatSettingsAction();
      if (!settingsResult.success) {
        toast.error(`Gagal ambil pengaturan format cetak: ${settingsResult.error}`);
        return;
      }
      const formatSettings = settingsResult.data;

      for (let i = 0; i < jobsResult.data.length; i++) {
        const job = jobsResult.data[i];

        // Claim-before-print (final review Finding 1): the row lock this
        // UPDATE takes prevents two concurrent pollers (e.g. two open
        // browser tabs) from both printing the same job. If another
        // poller already claimed it, skip silently — this is the
        // expected steady-state outcome of a race, not an error worth
        // interrupting the batch or the user over.
        const claimResult = await claimPrintQueueJobAction(job.printQueueId);
        if (!claimResult.success || !claimResult.data) {
          continue;
        }

        // Shared failure handler for the two "attempt to produce a
        // printed receipt" steps below (fetch data, send to printer).
        // Dead-letter/retry-limit (final review Finding 2): a LOW fail
        // count might just be "printer ran out of paper" — worth
        // pausing the whole batch so the next poll tick retries this
        // same job before touching anything after it. Once a job has
        // failed MAX_FAIL_COUNT times in a row, though, it's more likely
        // a permanent problem (deleted SalesInvoice, malformed data) —
        // mark it 'Error' (excluded from getPendingPrintQueue's `WHERE
        // Status = 'Pending'`) and move on so it can't wedge the queue
        // for everyone forever.
        const handleAttemptFailure = async (message: string): Promise<"break" | "continue"> => {
          const failResult = await incrementPrintQueueFailCountAction(job.printQueueId);
          if (!failResult.success) {
            // Couldn't even record the failure (transient DB error on
            // top of the print failure) — fall back to the pre-existing
            // behavior rather than guessing at a fail count we don't
            // actually have.
            toast.error(message);
            return "break";
          }
          if (failResult.data.failCount >= MAX_FAIL_COUNT) {
            await markPrintQueueErrorAction(job.printQueueId);
            toast.error(`SI ini gagal dicetak 3x, dilewati — cek printer/data. (${message})`);
            return "continue";
          }
          toast.error(message);
          return "break";
        };

        const dataResult = await getThermalReceiptDataAction(job.salesInvoiceId);
        if (!dataResult.success) {
          const action = await handleAttemptFailure(`Gagal ambil data SI untuk struk: ${dataResult.error}`);
          if (action === "break") break;
          continue;
        }
        try {
          await conn.send(await buildReceiptBytes(dataResult.data, formatSettings));
        } catch (err) {
          const action = await handleAttemptFailure(
            `Cetak gagal — periksa printer (kertas/koneksi). ${err instanceof Error ? err.message : ""}`
          );
          if (action === "break") break;
          continue;
        }
        const doneResult = await markPrintQueueDoneAction(job.printQueueId);
        if (!doneResult.success) {
          // The physical print already happened, but the DB write that
          // marks it done failed. The claim step above already moved this
          // row to 'Printing', so without reverting it here it would be
          // stuck forever (getPendingPrintQueue only looks at 'Pending').
          // Revert it back to 'Pending' so the job will look "Pending"
          // again on the next poll tick and get reprinted. That's an
          // acceptable, rare edge case (transient DB error right after a
          // successful send); we still stop the batch so we don't compound
          // it by racing further prints against an unreliable DB.
          await revertPrintQueueJobToPendingAction(job.printQueueId);
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
  }, []);

  useEffect(() => {
    const interval = setInterval(() => drainQueue(), POLL_INTERVAL_MS);
    const handlePollNow = () => drainQueue(true);
    window.addEventListener(POLL_NOW_EVENT, handlePollNow);
    return () => {
      clearInterval(interval);
      window.removeEventListener(POLL_NOW_EVENT, handlePollNow);
    };
  }, [drainQueue]);

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
