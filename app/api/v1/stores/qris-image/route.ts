import { NextRequest, NextResponse } from "next/server";
import { resolveVerifiedRequestActor } from "@/lib/auth/request-auth";
import { getDb } from "@/lib/db/client";
import { ManajerkuAppError } from "@/lib/services/platform-core";

const ALLOWED_QRIS_DATA_URL_PREFIXES = [
  "data:image/png;base64,",
  "data:image/jpeg;base64,",
  "data:image/jpg;base64,",
  "data:image/webp;base64,",
];
const MAX_QRIS_DATA_URL_CHARS = 2_800_000;

function handleRouteError(err: unknown) {
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
        code: "INTERNAL_ERROR",
        message:
          err instanceof Error ? err.message : "Terjadi kesalahan sistem.",
      },
    },
    { status: 500 }
  );
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const actor = resolveVerifiedRequestActor(
      req,
      body.storeId ? String(body.storeId) : undefined
    );
    const imageDataUrl =
      typeof body.imageDataUrl === "string" ? body.imageDataUrl.trim() : "";

    const hasValidPrefix = ALLOWED_QRIS_DATA_URL_PREFIXES.some((prefix) =>
      imageDataUrl.startsWith(prefix)
    );
    if (!hasValidPrefix) {
      throw new ManajerkuAppError(
        "INVALID_QRIS_IMAGE",
        "Format gambar QRIS harus PNG, JPG, atau WEBP.",
        400
      );
    }

    if (imageDataUrl.length > MAX_QRIS_DATA_URL_CHARS) {
      throw new ManajerkuAppError(
        "QRIS_IMAGE_TOO_LARGE",
        "Ukuran gambar QRIS maksimal 2 MB.",
        400
      );
    }

    const db = getDb();
    db.prepare("UPDATE stores SET qris_image_data_url = ? WHERE id = ?").run(
      imageDataUrl,
      actor.storeId
    );

    return NextResponse.json({
      success: true,
      data: {
        storeId: actor.storeId,
        qrisImageUrl: imageDataUrl,
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const storeIdParam = req.nextUrl.searchParams.get("storeId") || undefined;
    const actor = resolveVerifiedRequestActor(req, storeIdParam);
    const db = getDb();
    db.prepare("UPDATE stores SET qris_image_data_url = NULL WHERE id = ?").run(
      actor.storeId
    );

    return NextResponse.json({
      success: true,
      data: {
        storeId: actor.storeId,
        qrisImageUrl: null,
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

