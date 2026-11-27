import { NextRequest, NextResponse } from "next/server";
import { findListings } from "@/lib/listings/service";

// GET /api/listings?type=house&city=Panama%20City&maxPrice=100531[&minPrice=0][&live=0]
// Only type, city and price range are accepted. Income and savings never reach the server.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type");
  if (type !== "house" && type !== "vehicle") {
    return NextResponse.json({ error: "type must be house or vehicle" }, { status: 400 });
  }
  const city = (sp.get("city") ?? "").trim();
  if (!city || city.length > 60 || !/^[\p{L} .'-]+$/u.test(city)) {
    return NextResponse.json({ error: "city is missing or invalid" }, { status: 400 });
  }
  const maxPrice = Number(sp.get("maxPrice"));
  const minPrice = Number(sp.get("minPrice") ?? 0);
  if (!Number.isFinite(maxPrice) || maxPrice <= 0 || maxPrice > 10_000_000 || !Number.isFinite(minPrice) || minPrice < 0 || minPrice > maxPrice) {
    return NextResponse.json({ error: "price range is invalid" }, { status: 400 });
  }
  const live = sp.get("live") !== "0";

  const result = await findListings({ type, city, minPrice, maxPrice, live });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
