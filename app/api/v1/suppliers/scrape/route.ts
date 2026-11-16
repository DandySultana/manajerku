import { NextRequest, NextResponse } from "next/server";
import { resolveVerifiedRequestActor } from "@/lib/auth/request-auth";
import { scrapeSuppliersWithPlaywright } from "@/lib/services/playwright-supplier-scraper";
import { ManajerkuAppError } from "@/lib/services/platform-core";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const actor = resolveVerifiedRequestActor(
      req,
      body.storeId ? String(body.storeId) : undefined
    );

    const result = await scrapeSuppliersWithPlaywright({
      storeId: actor.storeId,
      searchQuery: String(body.searchQuery || ""),
      locationHint: body.locationHint ? String(body.locationHint) : undefined,
      productId: body.productId ? String(body.productId) : undefined,
      requestedQtyBoxes:
        typeof body.requestedQtyBoxes === "number"
          ? body.requestedQtyBoxes
          : undefined,
      maxResults:
        typeof body.maxResults === "number" ? body.maxResults : undefined,
      createRfqDraft: body.createRfqDraft !== false,
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    if (err instanceof ManajerkuAppError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: err.statusCode }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "PLAYWRIGHT_SCRAPE_ERROR",
          message:
            err instanceof Error
              ? err.message
              : "Gagal melakukan scraping supplier dengan Playwright.",
        },
      },
      { status: 500 }
    );
  }
}
