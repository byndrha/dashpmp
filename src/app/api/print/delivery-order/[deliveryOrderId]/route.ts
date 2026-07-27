import { NextRequest, NextResponse } from "next/server";
import { requireModuleAccess } from "@/lib/require-access";
import { getDeliveryOrderPrintData } from "@/lib/queries/delivery-order-print";
import { getDocTemplate } from "@/lib/queries/doc-template";
import { generateDeliveryOrderPdf } from "@/lib/pdf/delivery-order-pdf";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ deliveryOrderId: string }> }) {
  await requireModuleAccess("delivery");
  const { deliveryOrderId } = await params;

  const data = await getDeliveryOrderPrintData(deliveryOrderId);
  if (!data) {
    return NextResponse.json({ error: "Delivery Order tidak ditemukan" }, { status: 404 });
  }

  const template = await getDocTemplate("DeliveryOrder");
  const pdfBuffer = await generateDeliveryOrderPdf(data, template);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="DO-${data.header.VoucherNo.replace(/\//g, "-")}.pdf"`,
    },
  });
}
