import { describe, expect, it } from "vitest";
import { checkGift, nameMatches, type Claim } from "./check.js";
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
const capPage = { "/products/single-haul-cap": { body: "<html>Single Haul Cap</html>" } };
const capStore = store({ ...cart, ...capPage, "/products/single-haul-cap.js": { body: cap } });
const claim = (over: Partial<Claim>): Claim => ({ name: "Simms Single Haul Cap", price: 80, currency: "USD", url: CAP_URL, ...over });

function ldPage(nodes: unknown): string {
  return `<html><script type="application/ld+json">${JSON.stringify(nodes)}</script></html>`;
}

describe("checkGift", () => {
  it("verifies the store's title at the price an in-stock variant charges", async () => {
    const result = await checkGift(capStore, claim({}));
    expect(result.verdict).toBe("verified");
    expect(result.found).toMatchObject({ title: "Single Haul Cap", price: 80, currency: "USD", url: `${CAP_URL}?variant=2` });
  });

  it("rejects a sold-out variant's price, a made-up price, and a sold-out variant link", async () => {
    expect((await checkGift(capStore, claim({ price: 40 }))).verdict).toBe("price_changed");
    expect((await checkGift(capStore, claim({ price: 60 }))).verdict).toBe("price_changed");
    expect((await checkGift(capStore, claim({ price: 79.99 }))).verdict).toBe("price_changed");
    expect((await checkGift(capStore, claim({ price: 40, url: `${CAP_URL}?variant=1` }))).verdict).toBe("sold_out");
    const unknown = await checkGift(capStore, claim({ url: `${CAP_URL}?variant=9` }));
    expect(unknown.verdict).toBe("not_found");
    expect(unknown.found).toBeUndefined();
  });

  it("rejects a name that only shares the brand or some words", async () => {
    expect((await checkGift(capStore, claim({ name: "Simms Wading Boots" }))).verdict).toBe("name_mismatch");
    expect((await checkGift(capStore, claim({ name: "Simms Single Haul Cap Bundle" }))).verdict).toBe("name_mismatch");
    expect((await checkGift(capStore, claim({ name: "Simms Haul Single Cap" }))).verdict).toBe("name_mismatch");
    expect(nameMatches("FlowState Tumbler", "FlowState™ Tumbler")).toBe(true);
    expect(nameMatches("ハック", "バッグ")).toBe(false);
    expect(nameMatches("バッグ", "パッグ")).toBe(false);
    expect(nameMatches("Creme Brulee", "Crème Brûlée")).toBe(true);
  });

  it("matches accented titles and schema.org IRIs", async () => {
    const shop = store({
      "/item/creme": { body: ldPage({ "@type": "https://schema.org/Product", name: "Crème Brûlée Torch", brand: { name: "Fièvre" }, offers: { "@type": "Offer", price: "25", priceCurrency: "USD", availability: "https://schema.org/InStock" } }) },
    });
    expect((await checkGift(shop, { name: "Fievre Creme Brulee Torch", price: 25, currency: "USD", url: "https://shop.example/item/creme" })).verdict).toBe("verified");
  });

  it("takes price, stock and currency from the same offer", async () => {
    const offers = [
      { "@type": "Offer", price: "85", priceCurrency: "USD", availability: "https://schema.org/OutOfStock" },
      { "@type": "Offer", price: "85", priceCurrency: "EUR", availability: "https://schema.org/InStock" },
    ];
    const shop = store({ "/item/reel": { body: ldPage({ "@type": "Product", name: "Fly Reel", offers }) } });
    expect((await checkGift(shop, { name: "Fly Reel", price: 85, currency: "USD", url: "https://shop.example/item/reel" })).verdict).toBe("sold_out");
    const notIn = [{ "@type": "Offer", price: "85", priceCurrency: "USD", availability: "https://schema.org/NotInStock" }];
    const shop2 = store({ "/item/reel": { body: ldPage({ "@type": "Product", name: "Fly Reel", offers: notIn }) } });
    expect((await checkGift(shop2, { name: "Fly Reel", price: 85, currency: "USD", url: "https://shop.example/item/reel" })).verdict).toBe("sold_out");
    expect((await checkGift(shop2, { name: "Fly Reel", price: 85, currency: "USD", url: "https://shop.example/item/reel?variant=7" })).verdict).toBe("not_found");
  });

  it("rejects the wrong currency, made-up links and non-https URLs", async () => {
    expect((await checkGift(capStore, claim({ currency: "EUR" }))).verdict).toBe("currency_mismatch");
    expect((await checkGift(capStore, claim({ url: "https://www.simmsfishing.com/products/golden-reel" }))).verdict).toBe("not_found");
    const page = ldPage({ "@type": "Product", name: "Golden Reel", offers: { "@type": "Offer", price: "99", priceCurrency: "USD", availability: "https://schema.org/InStock" } });
    expect((await checkGift(capStore, claim({ name: "Golden Reel", price: 99, url: `data:text/html,${page}` }))).verdict).toBe("not_found");
  });

  it("survives a store that returns odd JSON", async () => {
    const odd = store({ ...cart, ...capPage, "/products/single-haul-cap.js": { body: { ...cap, vendor: null } } });
    expect((await checkGift(odd, claim({ name: "Simms Single Haul Cap" }))).verdict).toBe("name_mismatch");
    expect((await checkGift(odd, claim({ name: "Single Haul Cap" }))).verdict).toBe("verified");
  });

  it("rejects a product whose JSON outlives its page", async () => {
    const gone = store({ ...cart, "/products/single-haul-cap.js": { body: cap } });
    expect((await checkGift(gone, claim({}))).verdict).toBe("not_found");
    const down = store({ ...cart, "/products/single-haul-cap.js": { body: cap }, "/products/single-haul-cap": { status: 500, body: "" } });
    expect((await checkGift(down, claim({}))).verdict).toBe("unreachable");
  });

  it("reads a non-Shopify page's own Product, but not a listing page's", async () => {
    const offer = { "@type": "Offer", price: "34.95", priceCurrency: "USD", availability: "https://schema.org/InStock" };
    const shop = store({
      "/products/skillet": { body: ldPage({ "@graph": [{ "@type": "Product", name: "Cast Iron Skillet", offers: offer }] }) },
      "/collections/pans": { body: ldPage({ "@type": "ItemList", itemListElement: [{ "@type": "Product", name: "Cast Iron Skillet", offers: offer }] }) },
      "/collections/flat": { body: ldPage({ "@graph": [{ "@type": "CollectionPage" }, { "@type": "Product", name: "Cast Iron Skillet", offers: offer }] }) },
      "/collections/many": { body: ldPage([{ "@type": "Product", name: "Cast Iron Skillet", offers: offer }, { "@type": "Product", name: "Dutch Oven", offers: offer }]) },
      "/item/blocked": { status: 403, body: "denied" },
    });
    const skillet = { name: "Cast Iron Skillet", price: 34.95, currency: "USD" };
    expect((await checkGift(shop, { ...skillet, url: "https://shop.example/products/skillet" })).verdict).toBe("verified");
    for (const path of ["pans", "flat", "many"])
      expect((await checkGift(shop, { ...skillet, url: `https://shop.example/collections/${path}` })).verdict).toBe("not_a_product");
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
