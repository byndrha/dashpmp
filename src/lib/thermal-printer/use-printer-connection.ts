"use client";

import { useCallback, useEffect, useState } from "react";
import { connectViaBluetooth, connectViaUsb, reconnectPersisted, type ThermalPrinterConnection } from "./connection";

export type PrinterStatus = "disconnected" | "connecting" | "connected";

export function usePrinterConnection() {
  const [status, setStatus] = useState<PrinterStatus>("disconnected");
  // State rather than a ref: `connection` is part of the render output (the
  // brief's original ref-based draft read `.current` inside the returned
  // object, which the repo's react-hooks/refs lint rule rejects — reading a
  // ref during render). Since every write here already happens right
  // alongside a setStatus call, using state instead changes no observable
  // behavior.
  const [connection, setConnection] = useState<ThermalPrinterConnection | null>(null);

  // Silent restore on mount — see reconnectPersisted's own doc comment for
  // why this can never itself trigger a permission prompt.
  useEffect(() => {
    let cancelled = false;
    reconnectPersisted().then((conn) => {
      if (cancelled || !conn) return;
      setConnection(conn);
      setStatus("connected");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const connectBluetooth = useCallback(async () => {
    setStatus("connecting");
    try {
      const conn = await connectViaBluetooth();
      setConnection(conn);
      setStatus("connected");
    } catch {
      setStatus("disconnected");
    }
  }, []);

  const connectUsb = useCallback(async () => {
    setStatus("connecting");
    try {
      const conn = await connectViaUsb();
      setConnection(conn);
      setStatus("connected");
    } catch {
      setStatus("disconnected");
    }
  }, []);

  const disconnect = useCallback(() => {
    setConnection((prev) => {
      prev?.disconnect();
      return null;
    });
    setStatus("disconnected");
  }, []);

  return { status, connection, connectBluetooth, connectUsb, disconnect };
}
