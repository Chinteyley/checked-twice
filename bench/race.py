# Stream one prompt from Kimi K3.1 Pro on Cerebras and on a GPU host (OpenRouter), and time both.
# Writes race-<ts>.json with every token's arrival time, for the film's side-by-side.
import json, os, sys, time, threading, urllib.request
PROMPT = open(os.path.join(os.path.dirname(__file__), "prompt.txt")).read()
LANES = {
  "cerebras": ("https://api.cerebras.ai/v1/chat/completions", os.environ["CEREBRAS_API_KEY"], "moonshotai-kimi-k3.1-pro-trial", {"reasoning_effort": "low"}),
  "gpu": ("https://openrouter.ai/api/v1/chat/completions", os.environ["OPENROUTER_API_KEY"], "moonshotai/kimi-k3.1-pro", {"reasoning": {"effort": "low"}}),
}
out = {}
def run(name):
  url, key, model, extra = LANES[name]
  body = {"model": model, "stream": True, "max_tokens": 300, "temperature": 1.0, "messages": [{"role": "user", "content": PROMPT}], **extra}
  for attempt in range(30):
    t0 = time.time(); events = []; meta = {}
    try:
      req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
      with urllib.request.urlopen(req, timeout=180) as r:
        for line in r:
          line = line.decode().strip()
          if not line.startswith("data:") or line == "data: [DONE]": continue
          d = json.loads(line[5:], strict=False)
          for k in ("time_info", "usage", "provider"):
            if d.get(k): meta[k] = d[k]
          for c in d.get("choices", []):
            delta = c.get("delta", {})
            txt = delta.get("content") or ""
            rsn = delta.get("reasoning") or ""
            if txt or rsn: events.append([round(time.time() - t0, 4), txt, rsn])
      out[name] = {"attempts": attempt + 1, "events": events, "meta": meta, "total": round(time.time() - t0, 3)}
      return
    except urllib.error.HTTPError as e:
      msg = e.read()[:120]
      if e.code == 429: time.sleep(1.5); continue
      out[name] = {"error": f"{e.code} {msg}"}; return
  out[name] = {"error": "gave up after 30 attempts"}
ts = [threading.Thread(target=run, args=(n,)) for n in LANES]
[t.start() for t in ts]; [t.join() for t in ts]
for n, o in out.items():
  if "error" in o: print(n, o["error"]); continue
  ev = o["events"]; content = [e for e in ev if e[1]]
  first = ev[0][0] if ev else None
  print(n, "attempts", o["attempts"], "first token %.2fs" % first, "last %.2fs" % ev[-1][0], "chunks", len(ev), "usage", o["meta"].get("usage", {}).get("completion_tokens"), "time_info", {k: round(v, 3) for k, v in o["meta"].get("time_info", {}).items() if isinstance(v, float)})
json.dump(out, open(f"race-{int(time.time())}.json", "w"))
