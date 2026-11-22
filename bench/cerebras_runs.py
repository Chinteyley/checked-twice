# Five Cerebras-only runs of the race prompt (streamed, timed from send), to report a median
# wall clock beside the single GPU run. Saves every run with its token timings.
import json, os, time, urllib.request, statistics
PROMPT = open(os.path.join(os.path.dirname(__file__), "prompt.txt")).read()
K = os.environ["CEREBRAS_API_KEY"]
runs = []
while len(runs) < 5:
  body = {"model": "moonshotai-kimi-k3.1-pro-trial", "stream": True, "max_tokens": 300, "temperature": 1.0, "reasoning_effort": "low", "messages": [{"role": "user", "content": PROMPT}]}
  t0 = time.time(); events = []; meta = {}
  try:
    req = urllib.request.Request("https://api.cerebras.ai/v1/chat/completions", data=json.dumps(body).encode(), headers={"Authorization": "Bearer " + K, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
      for line in r:
        line = line.decode().strip()
        if not line.startswith("data:") or line == "data: [DONE]": continue
        d = json.loads(line[5:], strict=False)
        for k in ("time_info", "usage"):
          if d.get(k): meta[k] = d[k]
        for c in d.get("choices", []):
          dl = c.get("delta", {})
          if dl.get("content") or dl.get("reasoning"): events.append([round(time.time() - t0, 4), dl.get("content") or "", dl.get("reasoning") or ""])
  except urllib.error.HTTPError as e:
    if e.code == 429: time.sleep(2); continue
    raise
  ti = meta.get("time_info", {})
  runs.append({"events": events, "meta": meta, "first": events[0][0], "last": events[-1][0]})
  print("run", len(runs), "first %.2f last %.2f queue %.3f completion %.3f tokens %s" % (events[0][0], events[-1][0], ti.get("queue_time", -1), ti.get("completion_time", -1), meta.get("usage", {}).get("completion_tokens")))
  time.sleep(1)
print("median last", statistics.median(r["last"] for r in runs))
json.dump({"at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "runs": runs}, open(f"cerebras-runs-{int(time.time())}.json", "w"))
