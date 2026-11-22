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

Ask a chatbot for gift ideas and half the links are dead, the prices are a year old, and one product never existed. Gift lists are where hallucinated links hurt most: you find out at checkout. Checked Twice never lists a product, price or link that a store didn't hand back in the same turn.

And it has to be fast, because it's a conversation. On Cerebras, Kimi K3.1 Pro decodes at well over a thousand tokens per second, so the whole loop (search six stores, pick, check five pages, write the list) takes a few model turns that each finish in a blink.

## How it works

```
you ─► OpenClaw agent (Kimi K3.1 Pro on Cerebras)
          │  speedy-shopper skill: who is it for, what do they like, budget
          ├─► shop_search   6–8 stores' own catalogues, in parallel   (check 1: the list)
          │      Shopify storefront search: live title, URL, price, stock
          ├─► check_twice   every listed URL re-read, in parallel     (check 2: the list, again)
          │      same product? same price? in stock? else swap and re-check
          └─► 🎄 five gifts, each ✓✓
```

- **`shop_search`** queries stores' public product search (`/search/suggest.json`) and returns real products with absolute links, live prices, currency and stock. One call covers many stores.
- **`check_twice`** takes the exact list the agent is about to send and re-reads each page live: Shopify product JSON first, schema.org `Product` markup for other stores. Verdicts: `verified`, `price_changed`, `name_mismatch`, `sold_out`, `not_found`, `blocked`, `unreachable`. Only `verified` gifts make the list.
- **`speedy-shopper`** (skill) tells Kimi the loop: one wide search, pick five across three or more stores, check twice, swap failures, reply in a fixed shape.

No search API key, no scraping service, no product database: the stores are the source of truth.

## Run it

Needs Node 24+, OpenClaw 2026.11.x and a Cerebras API key with Kimi K3.1 Pro access.

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
