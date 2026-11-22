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

/** Lowercase letters and digits in order, marks and symbols dropped: "Micra®" is "micra". */
function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[™®℠'’]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The listed name is the store's own title, word for word, optionally with the brand in front. */
export function nameMatches(listed: string, title: string, vendor = ""): boolean {
  const said = normalize(listed);
  const own = normalize(title);
  return own.length > 0 && (said === own || said === `${normalize(vendor)} ${own}`);
}

function money(amount: number, currency: string): string {
  return `${currency === "USD" ? "$" : `${currency} `}${amount.toFixed(2)}`;
}

const cents = (amount: number): number => Math.round(amount * 100);

export function judge(claim: Claim, product: Product): Checked {
  const claimUrl = new URL(claim.url);
  const variantId = claimUrl.searchParams.get("variant");
  const hasVariants = product.offers.some((o) => o.variantId !== undefined);
  const offers = variantId && hasVariants ? product.offers.filter((o) => o.variantId === variantId) : product.offers;
  if (offers.length === 0) return { claim, verdict: "not_found", note: "that variant is not on the product page" };

  const inCurrency = offers.filter((o) => o.currency.toUpperCase() === claim.currency.toUpperCase());
  const inStock = inCurrency.filter((o) => o.available);
  const shown = inStock[0] ?? inCurrency[0] ?? offers[0];
  const found: Found = { title: product.title, url: product.url, price: shown.price, currency: shown.currency };
  const live = `${product.title} at ${money(shown.price, shown.currency)}`;

  if (!nameMatches(claim.name, product.title, product.vendor))
    return { claim, verdict: "name_mismatch", found, note: `page is ${live}; list the store's own title` };
  if (inCurrency.length === 0) return { claim, verdict: "currency_mismatch", found, note: `store prices in ${shown.currency}` };
  if (inStock.length === 0) return { claim, verdict: "sold_out", found, note: `${product.title} is sold out` };
  const match = inStock.find((o) => cents(o.price) === cents(claim.price));
  if (!match)
    return { claim, verdict: "price_changed", found, note: `listed ${money(claim.price, shown.currency)}; in stock at ${money(shown.price, shown.currency)}` };
  // Open the link on the variant that carries this price, not whichever the store shows first.
  const url = new URL(product.url);
  if (match.variantId && !variantId) url.searchParams.set("variant", match.variantId);
  return {
    claim,
    verdict: "verified",
    found: { title: product.title, url: url.href, price: match.price, currency: match.currency },
    note: `${product.title} at ${money(match.price, match.currency)}, in stock`,
  };
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
