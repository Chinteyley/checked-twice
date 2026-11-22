import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { Type } from "typebox";
import { checkGift } from "./check.js";
import { searchStore } from "./shop.js";

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
        "Search real online stores' own product catalogues (Shopify storefront search) in parallel. Returns live products with title, product page URL, price, currency and stock. Use several stores in one call.",
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
              const products = await searchStore(fetch, store, query, limit ?? 4, context.signal);
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
        "Re-read each gift's product page live from its store and confirm it is the same product, at the listed price, in stock. Call it with the exact list you will give the person; replace any gift whose verdict is not 'verified'.",
      workspaceAccess: false,
      parameters: Type.Object({
        gifts: Type.Array(
          Type.Object({
            name: Type.String({ description: "Product name as you will list it" }),
            price: Type.Number({ description: "Price as you will list it, in the store's currency" }),
            url: Type.String({ description: "Product page URL as you will list it" }),
          }),
          { minItems: 1, maxItems: 10 },
        ),
      }),
      async execute({ gifts }, _config, context) {
        const checked = await Promise.all(gifts.map((gift) => checkGift(fetch, gift, context.signal)));
        const verified = checked.filter((c) => c.verdict === "verified").length;
        return { verified, total: checked.length, checked };
      },
    }),
  ],
});
