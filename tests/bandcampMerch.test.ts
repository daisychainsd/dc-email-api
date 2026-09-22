import { test } from "node:test";
import assert from "node:assert/strict";
import { bandcampMerchResponse, fetchBandcampMerch } from "../src/lib/bandcampMerch";

test("physical feed is authenticated and never fetches orders for unauthorized callers", async () => {
  let calls = 0;
  const read = async () => { calls++; return { source: "bandcamp", bandId: 123, items: [] }; };
  const req = (token: string) => new Request("https://fixture.invalid/api/internal/bandcamp-merch", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await bandcampMerchResponse(req("wrong"), "secret", read)).status, 401);
  assert.equal(calls, 0);
  const result = await bandcampMerchResponse(req("secret"), "secret", read);
  assert.equal(result.status, 200); assert.equal(result.headers.get("cache-control"), "no-store"); assert.equal(calls, 1);
  const failure = await bandcampMerchResponse(req("secret"), "secret", async () => { throw new Error("PRIVATE TOKEN OR BUYER DATA"); });
  assert.equal(failure.status, 503); assert.doesNotMatch(await failure.text(), /PRIVATE/);
});
test("reads full physical order history from v4 using configured account, with no subscriber work", async () => {
  const oldBand = process.env.BANDCAMP_BAND_ID, oldMember = process.env.BANDCAMP_MEMBER_BAND_ID;
  process.env.BANDCAMP_BAND_ID = "123"; delete process.env.BANDCAMP_MEMBER_BAND_ID;
  try {
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(url, "https://bandcamp.com/api/merchorders/4/get_orders");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-token");
      assert.deepEqual(JSON.parse(String(init?.body)), { band_id: 123, unshipped_only: false, format: "json" });
      return Response.json({ success: true, items: [{ sale_item_id: 100 }] });
    }) as typeof fetch;
    assert.deepEqual(await fetchBandcampMerch(fake, async () => "fixture-token"), { source: "bandcamp", bandId: 123, items: [{ sale_item_id: 100 }] });
    await assert.rejects(fetchBandcampMerch(async () => Response.json({ report: [{ item_type: "track" }] }), async () => "fixture-token"), /Invalid Bandcamp merchandise response/);
    await assert.rejects(fetchBandcampMerch(async () => new Response("private", { status: 403 }), async () => "fixture-token"), /HTTP 403/);
  } finally {
    if (oldBand === undefined) delete process.env.BANDCAMP_BAND_ID; else process.env.BANDCAMP_BAND_ID = oldBand;
    if (oldMember === undefined) delete process.env.BANDCAMP_MEMBER_BAND_ID; else process.env.BANDCAMP_MEMBER_BAND_ID = oldMember;
  }
});
