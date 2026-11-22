// The second check: before a gift reaches the list, its page is read again, live, and it must
// still say what the list says (same product, same price, in stock).

import { readProduct, type Fetch, type Product, type ReadFailure } from "./shop.js";

export interface Claim { name: string; price: number; url: string }

export type Verdict = "verified" | "price_changed" | "name_mismatch" | "sold_out" | ReadFailure;

export interface Checked { claim: Claim; verdict: Verdict; found?: Product; note: string }

const STOP = new Set(["the", "a", "an", "and", "of", "for", "with", "by", "in", "x", "oz"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOP.has(w));
}

/** Share of the listed name's words that the store's own title also uses. */
export function nameOverlap(listed: string, title: string): number {
  const wanted = words(listed);
  if (wanted.length === 0) return 0;
  const have = new Set(words(title));
  return wanted.filter((w) => have.has(w)).length / wanted.length;
}

/** A listed price matches when it falls in the product's live price range, give or take a cent or 1%. */
export function priceMatches(listed: number, product: Product): boolean {
  const slack = Math.max(0.01, product.priceMax * 0.01);
  return listed >= product.price - slack && listed <= product.priceMax + slack;
}

function money(amount: number, currency: string): string {
  return `${currency === "USD" ? "$" : `${currency} `}${amount.toFixed(2)}`;
}

export function judge(claim: Claim, product: Product): Checked {
  const live = `${product.title} at ${money(product.price, product.currency)}`;
  if (nameOverlap(claim.name, `${product.vendor ?? ""} ${product.title}`) < 0.5)
    return { claim, verdict: "name_mismatch", found: product, note: `page is ${live}` };
  if (!product.available) return { claim, verdict: "sold_out", found: product, note: `${product.title} is sold out` };
  if (!priceMatches(claim.price, product))
    return { claim, verdict: "price_changed", found: product, note: `listed ${money(claim.price, product.currency)}, store says ${money(product.price, product.currency)}` };
  return { claim, verdict: "verified", found: product, note: `${live}, in stock` };
}

const FAILURE_NOTES: Record<ReadFailure, string> = {
  blocked: "store blocks automated checks; pick another store",
  not_found: "no product at this URL",
  not_a_product: "page has no product data",
  unreachable: "store did not answer",
};

export async function checkGift(fetchImpl: Fetch, claim: Claim, signal?: AbortSignal): Promise<Checked> {
  const read = await readProduct(fetchImpl, claim.url, signal);
  if (!read.ok) return { claim, verdict: read.failure, note: FAILURE_NOTES[read.failure] };
  return judge(claim, read.product);
}
