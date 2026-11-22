import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";
import { checkGift } from "./check.js";
import { guardedGet, searchStore } from "./shop.js";

// Two tools for the speedy-shopper skill. `shop_search` makes the list from stores' own live
// catalogues; `check_twice` re-reads every listed page before it reaches the person. Both run
// their requests in parallel, so one model turn covers every store.

export default defineToolPlugin({
  id: "checked-twice",
  name: "Checked Twice",
  description: "Find real gifts in stores' live catalogues, then check every link twice.",
  tools: (tool) => [
    tool({
      name: "shop_search",
      label: "Shop search",
      description:
        "Search real online stores' own product catalogues (Shopify storefront search) in parallel. Returns in-stock products with the store's title, product page URL, price and currency. Use several stores in one call.",
      workspaceAccess: false,
      parameters: Type.Object({
        searches: Type.Array(
          Type.Object({
            store: Type.String({ description: "Store domain, e.g. stanley1913.com" }),
            query: Type.String({ description: "Product search words, e.g. tumbler" }),
          }),
          { minItems: 1, maxItems: 10 },
        ),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "Products per search, default 4" })),
      }),
      async execute({ searches, limit }, _config, context) {
        const results = await Promise.all(
          searches.map(async ({ store, query }) => {
            try {
              const products = await searchStore(guardedGet, store, query, limit ?? 4, context.signal);
              return { store, query, products };
            } catch (error) {
              return { store, query, error: error instanceof Error ? error.message : String(error) };
            }
          }),
        );
        return { results };
      },
    }),
    tool({
      name: "check_twice",
      label: "Check twice",
      description:
        "Re-read each gift's product page live from its store and confirm the store's own title, an in-stock price and the currency. Pass 6-7 candidates; list only gifts whose verdict is 'verified', using each one's `found` title, price and URL.",
      workspaceAccess: false,
      parameters: Type.Object({
        gifts: Type.Array(
          Type.Object({
            name: Type.String({ description: "The store's product title, optionally with the brand in front" }),
            price: Type.Number({ exclusiveMinimum: 0, description: "Price in the store's currency" }),
            currency: Type.String({ description: "ISO currency code from shop_search, e.g. USD" }),
            url: Type.String({ description: "Product page URL from shop_search" }),
          }),
          { minItems: 1, maxItems: 10 },
        ),
      }),
      async execute({ gifts }, _config, context) {
        const checked = await Promise.all(gifts.map((gift) => checkGift(guardedGet, gift, context.signal)));
        const verified = checked.filter((c) => c.verdict === "verified").length;
        return { verified, total: checked.length, checked };
      },
    }),
  ],
});
