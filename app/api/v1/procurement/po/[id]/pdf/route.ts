import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const db = getDb();
  const po = db
    .prepare(
      `SELECT po.*, s.name as supplier_name, s.phone_whatsapp as supplier_phone,
              s.address as supplier_address, p.name as product_name, p.sku_code,
              st.name as store_name, st.branch_name, st.address as store_address
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       JOIN products p ON p.id = po.product_id
       JOIN stores st ON st.id = po.store_id
       WHERE po.id = ? OR po.po_number = ?`
    )
    .get(decodeURIComponent(id), decodeURIComponent(id));

  if (!po) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "PO_NOT_FOUND", message: "Purchase Order tidak ditemukan." },
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    data: po,
  });
}

