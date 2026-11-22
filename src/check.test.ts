import { describe, expect, it } from "vitest";
import { checkGift, type Claim } from "./check.js";
import { searchStore, type Get } from "./shop.js";

interface Route {
  status?: number;
  body: unknown;
}

// A fake store: each path answers with a fixed status and body, the way the real endpoints do.
function store(routes: Record<string, Route>): Get {
  return async (url) => {
    const route = routes[new URL(url).pathname];
    if (!route) return { status: 404, url, body: "not found" };
    const body = typeof route.body === "string" ? route.body : JSON.stringify(route.body);
    return { status: route.status ?? 200, url, body };
  };
}

const CAP_URL = "https://www.simmsfishing.com/products/single-haul-cap";
const cart = { "/cart.js": { body: { currency: "USD" } } };
const cap = {
  title: "Single Haul Cap",
  vendor: "Simms",
  variants: [
    { id: 1, price: 4000, available: false },
    { id: 2, price: 8000, available: true },
  ],
};
const capStore = store({ ...cart, "/products/single-haul-cap.js": { body: cap } });
const claim = (over: Partial<Claim>): Claim => ({ name: "Simms Single Haul Cap", price: 80, currency: "USD", url: CAP_URL, ...over });

function ldPage(nodes: unknown): string {
  return `<html><script type="application/ld+json">${JSON.stringify(nodes)}</script></html>`;
}

describe("checkGift", () => {
  it("verifies the store's title at the price an in-stock variant charges", async () => {
    const result = await checkGift(capStore, claim({}));
    expect(result.verdict).toBe("verified");
    expect(result.found).toMatchObject({ title: "Single Haul Cap", price: 80, currency: "USD" });
  });

  it("rejects a sold-out variant's price, a made-up price, and a sold-out variant link", async () => {
    expect((await checkGift(capStore, claim({ price: 40 }))).verdict).toBe("price_changed");
    expect((await checkGift(capStore, claim({ price: 60 }))).verdict).toBe("price_changed");
    expect((await checkGift(capStore, claim({ price: 40, url: `${CAP_URL}?variant=1` }))).verdict).toBe("sold_out");
  });

  it("rejects a name that only shares the brand or some words", async () => {
    expect((await checkGift(capStore, claim({ name: "Simms Wading Boots" }))).verdict).toBe("name_mismatch");
    expect((await checkGift(capStore, claim({ name: "Simms Single Haul Cap Bundle" }))).verdict).toBe("name_mismatch");
  });

  it("matches accented titles and schema.org IRIs", async () => {
    const shop = store({
      "/item/creme": { body: ldPage({ "@type": "https://schema.org/Product", name: "Crème Brûlée Torch", brand: { name: "Fièvre" }, offers: { "@type": "Offer", price: "25", priceCurrency: "USD", availability: "https://schema.org/InStock" } }) },
    });
    expect((await checkGift(shop, { name: "Fievre Creme Brulee Torch", price: 25, currency: "USD", url: "https://shop.example/item/creme" })).verdict).toBe("verified");
  });

  it("rejects the wrong currency, made-up links and non-https URLs", async () => {
    expect((await checkGift(capStore, claim({ currency: "EUR" }))).verdict).toBe("currency_mismatch");
    expect((await checkGift(capStore, claim({ url: "https://www.simmsfishing.com/products/golden-reel" }))).verdict).toBe("not_found");
    const page = ldPage({ "@type": "Product", name: "Golden Reel", offers: { "@type": "Offer", price: "99", priceCurrency: "USD", availability: "https://schema.org/InStock" } });
    expect((await checkGift(capStore, claim({ name: "Golden Reel", price: 99, url: `data:text/html,${page}` }))).verdict).toBe("not_found");
  });

  it("reads a non-Shopify page's own Product, but not one listed inside a collection", async () => {
    const offer = { "@type": "Offer", price: "34.95", priceCurrency: "USD", availability: "https://schema.org/InStock" };
    const shop = store({
      "/products/skillet": { body: ldPage({ "@graph": [{ "@type": "Product", name: "Cast Iron Skillet", offers: offer }] }) },
      "/collections/pans": { body: ldPage({ "@type": "ItemList", itemListElement: [{ "@type": "Product", name: "Cast Iron Skillet", offers: offer }] }) },
      "/item/blocked": { status: 403, body: "denied" },
    });
    const skillet = { name: "Cast Iron Skillet", price: 34.95, currency: "USD" };
    expect((await checkGift(shop, { ...skillet, url: "https://shop.example/products/skillet" })).verdict).toBe("verified");
    expect((await checkGift(shop, { ...skillet, url: "https://shop.example/collections/pans" })).verdict).toBe("not_a_product");
    expect((await checkGift(shop, { ...skillet, url: "https://shop.example/item/blocked" })).verdict).toBe("blocked");
  });
});

describe("searchStore", () => {
  it("maps a store's own search results to absolute links with live prices and its currency", async () => {
    const shop = store({
      ...cart,
      "/search/suggest.json": {
        body: { resources: { results: { products: [{ title: "Single Haul Cap", url: "/products/single-haul-cap?_pos=1&_ss=e", price: "40.00" }] } } },
      },
    });
    const [listing] = await searchStore(shop, "simmsfishing.com", "cap", 4);
    expect(listing).toEqual({
      title: "Single Haul Cap",
      url: "https://simmsfishing.com/products/single-haul-cap",
      store: "simmsfishing.com",
      price: 40,
      currency: "USD",
      vendor: undefined,
    });
  });
});
