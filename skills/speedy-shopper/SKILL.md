---
name: speedy-shopper
description: Find five real Christmas gifts from real online stores, each with a live product link, price and stock checked twice. Use when someone asks for gift ideas, a gift list, stocking stuffers, or something to buy for a person.
---

# Speedy shopper

Make the list from stores' live catalogues, then check it twice. Every gift on the list is a real product page that answered a moment ago. Never list a product, price or link that `check_twice` did not return as `verified` in this turn; print each gift's `found` title, price and URL, not your own wording.

## Steps

1. **Read the person.** From the request, take who it is for, what they like, and a budget (none given: under $100). Don't ask questions; pick sensible defaults and say them in one line at the end.
2. **Search once, wide.** One `shop_search` call with 6 to 8 searches across different stores that fit the person, one or two plain product words per query (`tumbler`, `slipper`, `candle`), never the word `gift`. Stores whose catalogue search is known to answer:

   | For | Stores |
   | --- | --- |
   | Outdoors, fishing | simmsfishing.com, mysterytacklebox.com, stanley1913.com, rumpl.com, leatherman.com |
   | Coffee, kitchen | fellowproducts.com, deathwishcoffee.com, greatjonesgoods.com, hexclad.com, graza.co |
   | Home, cosy | parachutehome.com, brooklinen.com, bearaby.com, homesick.com, boysmells.com |
   | Clothes, shoes | allbirds.com, kizik.com, taylorstitch.com, gymshark.com |
   | Play, games | explodingkittens.com, magnatiles.com |
   | Desk, grooming, beauty | ugmonk.com, beardbrand.com, glossier.com, puravidabracelets.com, loopearplugs.com |

   Other Shopify stores work too; a store that errors is skipped, not retried.
3. **Pick up to seven.** From the results, choose up to 7 in-stock products within budget (5 picks and 2 spares), from at least 3 different stores, in the store's currency. No gift cards, gift notes, subscriptions, memberships, replacement parts, refills, shipping protection, bundles of the same item, or anything over budget.
4. **Check twice.** One `check_twice` call with all of them, each with the store's own title (the brand may go in front), price, currency and URL exactly as `shop_search` returned them. Keep the first 5 whose verdict is `verified`. If fewer than 5 pass, run one more `shop_search` and one more `check_twice` for the gap, then reply with however many passed and say so.
5. **Reply** with the list in this shape and nothing before it:

   ```
   🎄 <n> gifts for <person>, checked twice

   1. **<found.title>** — <found.price> <found.currency> · <store>
      <found.url>
      ✓✓ <one line on why it suits them>
   ...

   Assumed: <defaults you picked, one line>
   ```

Keep reasoning short and the reply tight: speed is part of the gift.
