import { bandcampMerchResponse } from "@/lib/bandcampMerch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: Request) { return bandcampMerchResponse(request); }
