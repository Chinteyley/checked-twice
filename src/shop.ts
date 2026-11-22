// Live product data straight from a store's own catalogue: Shopify's public storefront JSON
// (`/search/suggest.json` and `/products/<handle>.js`), with the page's schema.org Product markup
// as the fallback for other stores. Nothing here is cached or invented: every field comes from
// the store's response to this request.

import { fetchWithSsrFGuard } from "openclaw/plugin-sdk/ssrf-runtime";

/** One fetched page: its status, the URL it ended at after redirects, and its body. */
export interface Page {
  status: number;
  url: string;
  body: string;
}

/** Fetches a URL. The plugin uses `guardedGet`; tests pass a fake store. */
export type Get = (url: string, accept: string, signal?: AbortSignal) => Promise<Page>;

/** A product as the store's search lists it. */
export interface Listing {
  title: string;
  url: string;
  store: string;
  price: number;
  currency: string;
  vendor?: string;
}

/** One way to buy a product: a variant or a schema.org offer, with its own currency. */
export interface Offer {
  price: number;
  currency: string;
  available: boolean;
  variantId?: string;
}

/** A product page as the store serves it now. */
export interface Product {
  title: string;
  url: string;
  store: string;
  vendor?: string;
  offers: Offer[];
}

/** Why a page could not be read as a product, when it couldn't. */
export type ReadFailure = "blocked" | "not_found" | "not_a_product" | "unreachable";

export type ReadResult = { ok: true; product: Product } | { ok: false; failure: ReadFailure };

const REQUEST_TIMEOUT_MS = 4000;
/** Product pages run to about 1 MB; anything far larger is not one. */
const MAX_BODY_BYTES = 3_000_000;
const MAX_REDIRECTS = 3;
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
};
const BLOCKED_STATUSES = new Set([401, 403, 429, 503]);
const GONE_STATUSES = new Set([404, 410]);
const LD_JSON = /<script[^>]*type=["']?application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Fetches over HTTPS only, through OpenClaw's SSRF guard: every hop's address is checked, so a
 * model-supplied URL or redirect cannot reach the host's own or private network.
 */
export const guardedGet: Get = async (url, accept, signal) => {
  const { response, finalUrl, release } = await fetchWithSsrFGuard({
    url,
    init: { headers: { ...HEADERS, accept } },
    requireHttps: true,
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    signal,
    auditContext: "checked-twice",
  });
  try {
    return { status: response.status, url: finalUrl, body: await readCapped(response) };
  } finally {
    await release();
  }
};

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("response too large to be a product page");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** `stanley1913.com`, `www.x.com/a/b` and `https://x.com/...` all name a store by its origin. */
export function storeOrigin(store: string): string {
  const url = new URL(/^https?:\/\//i.test(store) ? store : `https://${store}`);
  return `https://${url.host}`;
}

/** The store's currency for one storefront, read from that storefront's cart (`/en-ca/cart.js`). */
async function storeCurrency(get: Get, storefront: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const page = await get(`${storefront}/cart.js`, "application/json", signal);
    if (page.status !== 200) return undefined;
    const cart = parseJson(page.body) as { currency?: unknown } | undefined;
    return typeof cart?.currency === "string" && cart.currency.trim() ? cart.currency : undefined;
  } catch {
    return undefined;
  }
}

interface SuggestProduct {
  title: string;
  url: string;
  price: string;
  vendor?: string;
}

/** Search one store's own catalogue for in-stock products. Throws when it has no public search. */
export async function searchStore(
  get: Get,
  store: string,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Listing[]> {
  const origin = storeOrigin(store);
  const params = new URLSearchParams({
    q: query,
    "resources[type]": "product",
    "resources[limit]": String(limit),
    "resources[options][unavailable_products]": "hide",
  });
  const [page, currency] = await Promise.all([
    get(`${origin}/search/suggest.json?${params}`, "application/json", signal),
    storeCurrency(get, origin, signal),
  ]);
  if (page.status !== 200) throw new Error(`${origin} answered HTTP ${page.status} to a product search`);
  const body = parseJson(page.body) as { resources?: { results?: { products?: SuggestProduct[] } } } | undefined;
  const products = body?.resources?.results?.products;
  if (!Array.isArray(products)) throw new Error(`${origin} has no public product search`);
  if (!currency) throw new Error(`${origin} did not say its currency`);
  // Links use the store's canonical host (bare domains usually redirect to www).
  const finalOrigin = new URL(page.url || origin).origin;
  return products.filter((p) => Number(p.price) > 0).map((p) => ({
    title: p.title,
    url: `${finalOrigin}${new URL(p.url, finalOrigin).pathname}`,
    store: new URL(finalOrigin).host,
    price: Number(p.price),
    currency,
    vendor: p.vendor,
  }));
}

interface ShopifyVariant {
  id: number;
  price: unknown;
  available: unknown;
}

interface ShopifyProduct {
  title: string;
  vendor?: string;
  variants: ShopifyVariant[];
}

function isShopifyProduct(value: unknown): value is ShopifyProduct {
  const p = value as ShopifyProduct | undefined;
  return typeof p?.title === "string" && Array.isArray(p.variants);
}

function shopifyOffers(variants: ShopifyVariant[], currency: string): Offer[] {
  return variants.flatMap((v) =>
    typeof v.price === "number" && v.price > 0 && typeof v.available === "boolean"
      ? [{ price: v.price / 100, currency, available: v.available, variantId: String(v.id) }]
      : [],
  );
}

function fromPage(page: Page, fallbackUrl: string): ReadResult {
  if (BLOCKED_STATUSES.has(page.status)) return { ok: false, failure: "blocked" };
  if (GONE_STATUSES.has(page.status)) return { ok: false, failure: "not_found" };
  if (page.status !== 200) return { ok: false, failure: "unreachable" };
  const product = productFromHtml(page.body, page.url || fallbackUrl);
  return product ? { ok: true, product } : { ok: false, failure: "not_a_product" };
}

/**
 * Read the product a URL points at, from the store itself, at this moment. The page the person
 * will open is always fetched too: Shopify's product JSON can outlive a page that is gone.
 */
export async function readProduct(get: Get, rawUrl: string, signal?: AbortSignal): Promise<ReadResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, failure: "not_found" };
  }
  if (url.protocol !== "https:") return { ok: false, failure: "not_found" };
  try {
    const html = get(url.href, "text/html,application/xhtml+xml", signal);
    const at = url.pathname.indexOf("/products/");
    if (at >= 0) {
      const path = url.pathname.replace(/\/$/, "").replace(/\.(js|json)$/, "");
      // `/en-ca/products/x` prices in that market; `/collections/c/products/x` is the root store.
      const storefront = `${url.origin}${url.pathname.slice(0, at).replace(/\/collections\/[^/]+$/, "")}`;
      const [json, currency, page] = await Promise.all([
        get(`${url.origin}${path}.js`, "application/json", signal),
        storeCurrency(get, storefront, signal),
        html,
      ]);
      if (GONE_STATUSES.has(page.status)) return { ok: false, failure: "not_found" };
      // Shopify serves this as text/javascript, so parse the body rather than trust the header.
      const data = json.status === 200 ? parseJson(json.body) : undefined;
      const offers = isShopifyProduct(data) && currency ? shopifyOffers(data.variants, currency) : [];
      if (isShopifyProduct(data) && offers.length > 0) {
        const final = new URL(json.url || `${url.origin}${path}.js`);
        return {
          ok: true,
          product: {
            title: data.title,
            url: `${final.origin}${final.pathname.replace(/\.js$/, "")}${url.search}`,
            store: final.host,
            vendor: data.vendor,
            offers,
          },
        };
      }
      // Not a Shopify product endpoint, or no currency: read the page itself.
      return fromPage(page, url.href);
    }
    return fromPage(await html, url.href);
  } catch {
    return { ok: false, failure: "unreachable" };
  }
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `Product`, `schema:Product` and `https://schema.org/Product` all name the same type. */
function hasType(node: JsonObject, type: string): boolean {
  return list(node["@type"]).some((t) => typeof t === "string" && t.replace(/^(https?:\/\/schema\.org\/|schema:)/, "") === type);
}

function list(value: unknown): unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Offers with an explicit price, currency and availability; a range or a guess is not a price. */
function offersOf(node: JsonObject): Offer[] {
  const own = list(node.offers).filter(isObject).filter((o) => hasType(o, "Offer"));
  const variants = list(node.hasVariant).filter(isObject).flatMap((v) => offersOf(v));
  const offers = own.flatMap((o): Offer[] => {
    const price = Number(o.price);
    const currency = typeof o.priceCurrency === "string" ? o.priceCurrency.trim() : "";
    if (!(price > 0) || !currency || typeof o.availability !== "string") return [];
    return [{ price, currency, available: /InStock$/.test(o.availability) }];
  });
  return [...offers, ...variants];
}

const LISTING_TYPES = ["ItemList", "CollectionPage", "SearchResultsPage"];

/**
 * The page's own Product: the one top-level schema.org Product (or member of its @graph). A page
 * that declares itself a listing, or carries several products, is not a product page.
 */
export function productFromHtml(html: string, pageUrl: string): Product | undefined {
  const nodes = [...html.matchAll(LD_JSON)]
    .flatMap(([, json]) => list(parseJson(json)))
    .filter(isObject)
    .flatMap((n) => (Array.isArray(n["@graph"]) ? n["@graph"] : [n]))
    .filter(isObject);
  if (nodes.some((n) => LISTING_TYPES.some((t) => hasType(n, t)))) return undefined;
  const products = nodes.filter((n) => hasType(n, "Product") || hasType(n, "ProductGroup"));
  if (new Set(products.map((p) => p.name)).size !== 1) return undefined;
  const [node] = products;
  const offers = offersOf(node);
  if (typeof node.name !== "string" || offers.length === 0) return undefined;
  const url = new URL(pageUrl);
  const brand = isObject(node.brand) ? node.brand.name : node.brand;
  return { title: node.name, url: url.href, store: url.host, vendor: typeof brand === "string" ? brand : undefined, offers };
}
