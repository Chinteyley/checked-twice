# Checked Twice

**Kimi makes the list. The stores check it twice.**

An [OpenClaw](https://github.com/openclaw/openclaw) plugin and skill that finds five real Christmas gifts for anyone, in seconds, running on **Kimi K3.1 Pro on Cerebras**. Every gift is a live product page: the list is made from stores' own catalogues, then every link is opened again and must still show the same product, at the same price, in stock, before it reaches you.

Ask for gifts, and you get gifts that exist:

```
🎄 5 gifts for your dad, checked twice

1. **Leatherman Micra®** — $49.95 · Leatherman
   https://leatherman.com/products/micra
   ✓✓ A compact multitool for cutting line and handling small fishing repairs.
...
```

## Why

Ask a chatbot for gift ideas and half the links are dead, the prices are a year old, and one product never existed. Gift lists are where hallucinated links hurt most: you find out at checkout. Checked Twice only lists gifts that a store confirmed in the same turn, and it prints the store's own title, price and link, not the model's wording.

And it has to be fast, because it's a conversation. On Cerebras, Kimi K3.1 Pro wrote a five-gift list (300 tokens) in a median 0.66 s from first token to last, against 3.61 s for the same prompt on a GPU host through OpenRouter (measured Nov 22, 2026 with `bench/`; the hackathon queue added 0 to 8 s before Cerebras' first token). The whole loop (search the stores, pick, check every page, write the list) is a handful of model turns.

## How it works

```
you ─► OpenClaw agent (Kimi K3.1 Pro on Cerebras)
          │  speedy-shopper skill: who is it for, what do they like, budget
          ├─► shop_search   6–8 stores' own catalogues, in parallel   (check 1: the list)
          │      Shopify storefront search: live title, URL, price, stock
          ├─► check_twice   every listed URL re-read, in parallel     (check 2: the list, again)
          │      store's own title? an in-stock variant's price? same currency?
          └─► 🎄 five gifts, each ✓✓
```

- **`shop_search`** queries stores' public product search (`/search/suggest.json`) and returns real products with absolute links, live prices, currency and stock. One call covers many stores.
- **`check_twice`** takes the candidates the agent wants to send and re-reads each page live: Shopify product JSON first, the page's own schema.org `Product` for other stores. A gift is `verified` only when the listed name is the store's title, the price is what an in-stock variant charges now, and the currency matches. Otherwise: `price_changed`, `name_mismatch`, `currency_mismatch`, `sold_out`, `not_found`, `not_a_product`, `blocked` or `unreachable`. Every request goes through OpenClaw's SSRF guard, HTTPS only.
- **`speedy-shopper`** (skill) tells Kimi the loop: one wide search, seven candidates across three or more stores, one check for all seven, the first five verified make the list, printed from what the store returned.

No search API key, no scraping service, no product database: the stores are the source of truth.

## Run it

Needs Node 24+, Bun, OpenClaw 2026.11.x and a Cerebras API key with Kimi K3.1 Pro access.

```bash
npm i -g openclaw
git clone https://github.com/Chinteyley/checked-twice && cd checked-twice
bun install && bun run plugin:build

export CEREBRAS_API_KEY=csk-...           # never commit it
openclaw plugins install --link . --accept-capabilities
openclaw config patch --file config/openclaw.json5   # Kimi K3.1 Pro on Cerebras as the default model

openclaw agent --local -m "Find 5 Christmas gifts for my dad. He loves fishing and coffee. Around \$60 each."
```

Or open the Control UI (`openclaw dashboard`) and ask in the chat. `config/openclaw.json5` follows the hackathon's example config: model `moonshotai-kimi-k3.1-pro-trial`, `reasoning_effort` low, and `tools.toolSearch: false` so the agent calls the two tools directly instead of through the tool-search bridge (fewer model round trips).

## Test

```bash
bun run test            # verdict logic against fake stores
bun run plugin:validate # OpenClaw manifest + entry check
```

## Built for

The Cerebras × Kimi K3.1 Pro × OpenClaw weekend hackathon, Nov 21–22, 2026. It also completes the 🎅 Santa's Speedy Shopper task: five real gifts from real retail sites, each with its product page link.

#KimiOnCerebras · [@Cerebras](https://x.com/Cerebras) · [@Kimi_Moonshot](https://x.com/Kimi_Moonshot)

## License

MIT
