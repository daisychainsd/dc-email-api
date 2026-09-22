import { getBandcampAccessToken } from "./bandcampAuth";

// Separate from the sales report and its subscriber cursor: this endpoint only
// contains physical merchandise, including CDs/vinyl with bundled downloads.
export async function fetchBandcampMerch(fetcher: typeof fetch = fetch, accessToken = getBandcampAccessToken) {
  const bandId = Number(process.env.BANDCAMP_BAND_ID);
  if (!Number.isSafeInteger(bandId) || bandId <= 0) throw new Error("Missing Bandcamp band ID");
  const member = process.env.BANDCAMP_MEMBER_BAND_ID;
  const memberId = member ? Number(member) : undefined;
  if (memberId !== undefined && (!Number.isSafeInteger(memberId) || memberId <= 0)) throw new Error("Invalid Bandcamp member ID");
  const token = await accessToken();
  const response = await fetcher("https://bandcamp.com/api/merchorders/4/get_orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    // No date cursor or shipped filter: backfill history and notice late payments/refunds.
    body: JSON.stringify({ band_id: bandId, ...(memberId ? { member_band_id: memberId } : {}), unshipped_only: false, format: "json" }),
    cache: "no-store", signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Bandcamp merchandise API HTTP ${response.status}`);
  const data = await response.json();
  if (data.success !== true || !Array.isArray(data.items)) throw new Error("Invalid Bandcamp merchandise response");
  return { source: "bandcamp", bandId, items: data.items };
}

export async function bandcampMerchResponse(request: Request, secret = process.env.INTERNAL_SECRET, read = fetchBandcampMerch) {
  const headers = { "Cache-Control": "no-store" };
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers });
  }
  try { return Response.json(await read(), { headers }); }
  catch {
    // Never expose token responses or customer records in errors/logs.
    return Response.json({ error: "Bandcamp physical orders unavailable" }, { status: 503, headers });
  }
}
