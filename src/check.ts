// The second check: before a gift reaches the list, its page is read again, live, and it must
// still say what the list says: the store's own product name, a price an in-stock variant
// charges today, in the store's currency.

import { readProduct, type Get, type Product, type ReadFailure } from "./shop.js";

export interface Claim {
  name: string;
  price: number;
  currency: string;
  url: string;
}

export type Verdict = "verified" | "price_changed" | "name_mismatch" | "currency_mismatch" | "sold_out" | ReadFailure;

/** What the store says now, for the agent to print instead of its own wording. */
export interface Found {
  title: string;
  url: string;
  price: number;
  currency: string;
}

export interface Checked {
  claim: Claim;
  verdict: Verdict;
  found?: Found;
  note: string;
}

/** One deadline for both reads of a gift (product JSON, then the page). */
const CHECK_DEADLINE_MS = 6000;
const PRICE_SLACK = 0.01;

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0),
  );
}

/**
 * The listed name is the store's title, optionally with the brand in front: every word of the
 * title is in it, and it adds no word that is not the title's or the brand's.
 */
export function nameMatches(listed: string, title: string, vendor = ""): boolean {
  const said = words(listed);
  const titleWords = words(title);
  const allowed = new Set([...titleWords, ...words(vendor)]);
  return titleWords.size > 0 && [...titleWords].every((w) => said.has(w)) && [...said].every((w) => allowed.has(w));
}

function money(amount: number, currency: string): string {
  return `${currency === "USD" ? "$" : `${currency} `}${amount.toFixed(2)}`;
}

export function judge(claim: Claim, product: Product): Checked {
  const variantId = new URL(claim.url).searchParams.get("variant") ?? undefined;
  const offers = variantId ? product.offers.filter((o) => o.variantId === variantId) : product.offers;
  const inStock = offers.filter((o) => o.available);
  const cheapest = Math.min(...(inStock.length > 0 ? inStock : offers).map((o) => o.price));
  const found: Found = { title: product.title, url: product.url, price: cheapest, currency: product.currency };
  const live = `${product.title} at ${money(cheapest, product.currency)}`;

  if (!nameMatches(claim.name, product.title, product.vendor))
    return { claim, verdict: "name_mismatch", found, note: `page is ${live}; list the store's own title` };
  if (claim.currency.toUpperCase() !== product.currency.toUpperCase())
    return { claim, verdict: "currency_mismatch", found, note: `store prices in ${product.currency}` };
  if (inStock.length === 0) return { claim, verdict: "sold_out", found, note: `${product.title} is sold out` };
  const match = inStock.find((o) => Math.abs(o.price - claim.price) <= PRICE_SLACK);
  if (!match)
    return {
      claim,
      verdict: "price_changed",
      found,
      note: `listed ${money(claim.price, product.currency)}, in stock from ${money(cheapest, product.currency)}`,
    };
  return { claim, verdict: "verified", found: { ...found, price: match.price }, note: `${product.title} at ${money(match.price, product.currency)}, in stock` };
}

const FAILURE_NOTES: Record<ReadFailure, string> = {
  blocked: "store blocks automated checks; pick another store",
  not_found: "no product at this URL",
  not_a_product: "page has no product with a price and stock",
  unreachable: "store did not answer",
};

export async function checkGift(get: Get, claim: Claim, signal?: AbortSignal): Promise<Checked> {
  const deadline = AbortSignal.timeout(CHECK_DEADLINE_MS);
  const read = await readProduct(get, claim.url, signal ? AbortSignal.any([signal, deadline]) : deadline);
  if (!read.ok) return { claim, verdict: read.failure, note: FAILURE_NOTES[read.failure] };
  return judge(claim, read.product);
}
