import { describe, expect, it } from "vitest";
import { checkGift } from "./check.js";
import { searchStore, type Fetch } from "./shop.js";

// A fake store: each path answers with a fixed status and body, like the real endpoints do.
function store(routes: Record<string, { status?: number; json?: unknown; html?: string }>): Fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const route = routes[url.pathname];
    if (!route) return new Response("not found", { status: 404 });
    if (route.html !== undefined)
      return new Response(route.html, { status: route.status ?? 200, headers: { "content-type": "text/html" } });
    return new Response(JSON.stringify(route.json), {
      status: route.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as Fetch;
}

const cap = { title: "Single Haul Cap", price: 4000, price_min: 4000, price_max: 4000, available: true, vendor: "Simms" };
const cart = { "/cart.js": { json: { currency: "USD" } } };

describe("checkGift", () => {
  it("verifies a listed gift against the store's live product JSON", async () => {
    const fetchImpl = store({ ...cart, "/products/single-haul-cap.js": { json: cap } });
    const result = await checkGift(fetchImpl, {
      name: "Simms Single Haul Cap",
      price: 40,
      url: "https://www.simmsfishing.com/products/single-haul-cap",
    });
    expect(result.verdict).toBe("verified");
    expect(result.found?.price).toBe(40);
  });

  it("catches a listed price the store no longer charges", async () => {
    const fetchImpl = store({ ...cart, "/products/single-haul-cap.js": { json: cap } });
    const result = await checkGift(fetchImpl, {
      name: "Single Haul Cap",
      price: 29.99,
      url: "https://www.simmsfishing.com/products/single-haul-cap",
    });
    expect(result.verdict).toBe("price_changed");
  });

  it("catches a link that points at a different product", async () => {
    const fetchImpl = store({ ...cart, "/products/single-haul-cap.js": { json: cap } });
    const result = await checkGift(fetchImpl, {
      name: "Waterproof Wading Boots",
      price: 40,
      url: "https://www.simmsfishing.com/products/single-haul-cap",
    });
    expect(result.verdict).toBe("name_mismatch");
  });

  it("rejects sold-out gifts and made-up links", async () => {
    const fetchImpl = store({ ...cart, "/products/single-haul-cap.js": { json: { ...cap, available: false } } });
    const soldOut = await checkGift(fetchImpl, {
      name: "Single Haul Cap",
      price: 40,
      url: "https://www.simmsfishing.com/products/single-haul-cap",
    });
    const madeUp = await checkGift(fetchImpl, {
      name: "Golden Reel",
      price: 99,
      url: "https://www.simmsfishing.com/products/golden-reel",
    });
    expect(soldOut.verdict).toBe("sold_out");
    expect(madeUp.verdict).toBe("not_found");
  });

  it("reads schema.org Product markup on stores without product JSON, and reports bot walls", async () => {
    const page = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Cast Iron Skillet","offers":{"@type":"Offer","price":"34.95","priceCurrency":"USD","availability":"https://schema.org/InStock"}}]}</script>`;
    const fetchImpl = store({ "/item/skillet": { html: page }, "/item/blocked": { status: 403, html: "denied" } });
    const ok = await checkGift(fetchImpl, { name: "Cast Iron Skillet", price: 34.95, url: "https://shop.example/item/skillet" });
    const blocked = await checkGift(fetchImpl, { name: "Thing", price: 1, url: "https://shop.example/item/blocked" });
    expect(ok.verdict).toBe("verified");
    expect(blocked.verdict).toBe("blocked");
  });
});

describe("searchStore", () => {
  it("maps a store's own search results to absolute product links with live prices", async () => {
    const fetchImpl = store({
      ...cart,
      "/search/suggest.json": {
        json: {
          resources: {
            results: {
              products: [
                { title: "Single Haul Cap", url: "/products/single-haul-cap?_pos=1&_ss=e", price: "40.00", available: true },
              ],
            },
          },
        },
      },
    });
    const [product] = await searchStore(fetchImpl, "simmsfishing.com", "cap", 4);
    expect(product).toMatchObject({
      title: "Single Haul Cap",
      url: "https://simmsfishing.com/products/single-haul-cap",
      price: 40,
      currency: "USD",
      available: true,
    });
  });
});
