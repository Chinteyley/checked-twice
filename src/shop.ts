// Live product data straight from a store's own catalogue: Shopify's public storefront JSON
// (`/search/suggest.json` and `/products/<handle>.js`), with the page's schema.org Product markup
// as the fallback for other stores. Nothing here is cached or invented: every field comes from
// the store's response to this request.

export type Fetch = typeof fetch;

export interface Product {
  title: string;
  url: string;
  store: string;
  price: number;
  priceMax: number;
  currency: string;
  available: boolean;
  vendor?: string;
  image?: string;
}

/** Why a page could not be read as a product, when it couldn't. */
export type ReadFailure = "blocked" | "not_found" | "not_a_product" | "unreachable";

export type ReadResult = { ok: true; product: Product } | { ok: false; failure: ReadFailure; status?: number };

const TIMEOUT_MS = 8000;
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
};

/** `stanley1913.com`, `www.x.com/a/b` and `https://x.com/...` all name a store by its origin. */
export function storeOrigin(store: string): string {
  const url = new URL(/^https?:\/\//i.test(store) ? store : `https://${store}`);
  return `https://${url.host}`;
}

async function get(fetchImpl: Fetch, url: string, accept: string, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  return fetchImpl(url, {
    headers: { ...HEADERS, accept },
    redirect: "follow",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
}

async function storeCurrency(fetchImpl: Fetch, origin: string, signal?: AbortSignal): Promise<string> {
  try {
    const res = await get(fetchImpl, `${origin}/cart.js`, "application/json", signal);
    const cart = (await res.json()) as { currency?: unknown };
    return typeof cart.currency === "string" ? cart.currency : "USD";
  } catch {
    return "USD";
  }
}

interface SuggestProduct {
  title: string;
  url: string;
  price: string;
  price_max?: string;
  available: boolean;
  vendor?: string;
  image?: string;
}

/** Search one store's own catalogue. Throws when the store has no public product search. */
export async function searchStore(
  fetchImpl: Fetch,
  store: string,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Product[]> {
  const origin = storeOrigin(store);
  const params = new URLSearchParams({ q: query, "resources[type]": "product", "resources[limit]": String(limit) });
  const [res, currency] = await Promise.all([
    get(fetchImpl, `${origin}/search/suggest.json?${params}`, "application/json", signal),
    storeCurrency(fetchImpl, origin, signal),
  ]);
  if (!res.ok) throw new Error(`${origin} answered HTTP ${res.status} to a product search`);
  const body = parseJson(await res.text()) as { resources?: { results?: { products?: SuggestProduct[] } } } | undefined;
  const products = body?.resources?.results?.products;
  if (!Array.isArray(products)) throw new Error(`${origin} has no public product search`);
  // Links use the store's canonical host (bare domains usually redirect to www).
  const finalOrigin = res.url ? new URL(res.url).origin : origin;
  return products.map((p) => ({
    title: p.title,
    url: `${finalOrigin}${new URL(p.url, finalOrigin).pathname}`,
    store: new URL(finalOrigin).host,
    price: Number(p.price),
    priceMax: Number(p.price_max ?? p.price),
    currency,
    available: p.available,
    vendor: p.vendor,
    image: p.image,
  }));
}

interface ShopifyProduct {
  title: string;
  price: number;
  price_min?: number;
  price_max?: number;
  available: boolean;
  vendor?: string;
  featured_image?: string | null;
}

function absoluteImage(src: string | null | undefined): string | undefined {
  if (!src) return undefined;
  return src.startsWith("//") ? `https:${src}` : src;
}

/** Read the product a URL points at, from the store itself, at this moment. */
export async function readProduct(fetchImpl: Fetch, rawUrl: string, signal?: AbortSignal): Promise<ReadResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, failure: "not_found" };
  }
  const origin = url.origin;
  try {
    if (url.pathname.includes("/products/")) {
      const path = url.pathname.replace(/\/$/, "").replace(/\.(js|json)$/, "");
      const [res, currency] = await Promise.all([
        get(fetchImpl, `${origin}${path}.js`, "application/json", signal),
        storeCurrency(fetchImpl, origin, signal),
      ]);
      if (res.status === 404) return { ok: false, failure: "not_found", status: 404 };
      // Shopify serves this as text/javascript, so parse the body rather than trust the header.
      const p = res.ok ? (parseJson(await res.text()) as ShopifyProduct | undefined) : undefined;
      if (p && typeof p.title === "string" && typeof p.price === "number") {
        const finalOrigin = res.url ? new URL(res.url).origin : origin;
        return {
          ok: true,
          product: {
            title: p.title,
            url: `${finalOrigin}${path}`,
            store: new URL(finalOrigin).host,
            price: (p.price_min ?? p.price) / 100,
            priceMax: (p.price_max ?? p.price) / 100,
            currency,
            available: p.available,
            vendor: p.vendor,
            image: absoluteImage(p.featured_image),
          },
        };
      }
    }
    const res = await get(fetchImpl, url.href, "text/html,application/xhtml+xml", signal);
    if ([401, 403, 429, 503].includes(res.status)) return { ok: false, failure: "blocked", status: res.status };
    if (res.status === 404 || res.status === 410) return { ok: false, failure: "not_found", status: res.status };
    if (!res.ok) return { ok: false, failure: "unreachable", status: res.status };
    const product = productFromHtml(await res.text(), url.href);
    return product ? { ok: true, product } : { ok: false, failure: "not_a_product", status: res.status };
  } catch {
    return { ok: false, failure: "unreachable" };
  }
}

type JsonObject = Record<string, unknown>;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasType(node: JsonObject, type: string): boolean {
  const t = node["@type"];
  return t === type || (Array.isArray(t) && t.includes(type));
}

function* walk(node: unknown): Generator<JsonObject> {
  if (Array.isArray(node)) for (const item of node) yield* walk(item);
  else if (isObject(node)) {
    yield node;
    for (const value of Object.values(node)) if (typeof value === "object") yield* walk(value);
  }
}

/** The first schema.org Product on a page, with its price and stock from its offers. */
export function productFromHtml(html: string, pageUrl: string): Product | undefined {
  const scripts = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, json] of scripts) {
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      continue;
    }
    for (const node of walk(data)) {
      if (!hasType(node, "Product") && !hasType(node, "ProductGroup")) continue;
      const offers = [...walk(node.offers)].filter((o) => hasType(o, "Offer") || hasType(o, "AggregateOffer"));
      const prices = offers.flatMap((o) => [o.price, o.lowPrice, o.highPrice]).map(Number).filter((n) => n > 0);
      if (typeof node.name !== "string" || prices.length === 0) continue;
      const url = new URL(pageUrl);
      const image = Array.isArray(node.image) ? node.image[0] : node.image;
      return {
        title: node.name,
        url: url.href,
        store: url.host,
        price: Math.min(...prices),
        priceMax: Math.max(...prices),
        currency: String(offers.find((o) => o.priceCurrency)?.priceCurrency ?? "USD"),
        available: offers.some((o) => String(o.availability ?? "InStock").includes("InStock")),
        image: typeof image === "string" ? image : undefined,
      };
    }
  }
  return undefined;
}
