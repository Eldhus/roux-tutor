// The Speed page: save-to-pixels timing, and a drag race in the browser.
// roux dev tells this page when a new build serves (/_dev/events) and what
// its last pass cost (/_dev/stats); the browser's own timings say the rest,
// and each answer's Server-Timing header says the app's time.
(() => {
  const $ = (name) => document.querySelector(`[data-roux="${name}"]`);
  const told = "roux-speed:told";
  const kept = "roux-speed:history";
  const ms = (x) => x < 1
    ? `${Math.max(1, Math.round(x * 1000))} µs`
    : `${x < 10 ? x.toFixed(1) : Math.round(x)} ms`;
  const load = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };

  // ── Save to pixels ──────────────────────────────────────────────────────
  // When the stream names a new build, its time is kept: roux's own script
  // reloads the page now, and the next load measures from it.
  const events = new EventSource("/_dev/events");
  let first = true;
  events.onmessage = () => {
    if (first) { first = false; return; }
    sessionStorage.setItem(told, String(performance.timeOrigin + performance.now()));
  };

  const painted = () => new Promise((done) => {
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    if (paint) return done(paint.startTime);
    new PerformanceObserver((list, observer) => {
      observer.disconnect();
      done(list.getEntries()[0].startTime);
    }).observe({ type: "paint", buffered: true });
    setTimeout(() => done(performance.now()), 1500);
  });
  const loaded = () => new Promise((done) => {
    if (document.readyState === "complete") return done();
    addEventListener("load", () => done(), { once: true });
  });

  const show = (t) => {
    const total = t.roux + t.net + t.ready + t.paint;
    $("total").textContent = ms(total);
    $("roux").textContent = ms(t.roux);
    $("net").textContent = ms(t.net);
    $("ready").textContent = ms(t.ready);
    $("paint").textContent = ms(t.paint);
    const [r, n, d, p] = $("track").children;
    const share = (x) => `${(100 * x / Math.max(total, 0.001)).toFixed(2)}%`;
    r.style.width = share(t.roux); n.style.width = share(t.net);
    d.style.width = share(t.ready); p.style.width = share(t.paint);
  };

  const history = load(kept, []);
  const drawHistory = () => {
    const most = Math.max(1, ...history.map((h) => h.roux + h.net + h.ready + h.paint));
    $("history").innerHTML = history.map((h) => {
      const total = h.roux + h.net + h.ready + h.paint;
      const w = (x) => (100 * x / most).toFixed(2);
      return `<li><span class="mini"><i class="p-roux" style="width:${w(h.roux)}%"></i>` +
        `<i class="p-net" style="width:${w(h.net)}%"></i><i class="p-ready" style="width:${w(h.ready)}%"></i>` +
        `<i class="p-paint" style="width:${w(h.paint)}%"></i></span>${ms(total)}</li>`;
    }).join("");
  };

  (async () => {
    let stats = {};
    try {
      const answer = await fetch("/_dev/stats", { cache: "no-store" });
      if (answer.headers.get("content-type")?.startsWith("application/json")) stats = await answer.json();
    } catch {}
    if (stats.built === undefined) {
      $("note").textContent = "Run this under ./roux dev to time your edits.";
      drawHistory();
      return;
    }
    if (stats.built !== "templates") $("roc").textContent = ms(stats.micros / 1000);
    const at = Number(sessionStorage.getItem(told));
    sessionStorage.removeItem(told);
    if (at && stats.built === "templates") {
      await loaded();
      const nav = performance.getEntriesByType("navigation")[0];
      const paint = await painted();
      // From the stream's word to the reload, and the page's own phases.
      const before = Math.max(0, performance.timeOrigin - at);
      const timing = {
        roux: stats.micros / 1000,
        net: before + nav.responseEnd,
        ready: Math.max(0, nav.loadEventStart - nav.responseEnd),
        paint: Math.max(0, paint - nav.loadEventStart),
      };
      show(timing);
      history.unshift(timing);
      history.length = Math.min(history.length, 8);
      try { localStorage.setItem(kept, JSON.stringify(history)); } catch {}
      $("note").textContent = "Save again. Most of it is the browser: roux's part is the first sliver.";
    } else if (history.length > 0) {
      show(history[0]);
      $("note").textContent = "Your last edits, newest first. Save again to add one.";
    }
    drawHistory();
  })();

  // ── The drag race ───────────────────────────────────────────────────────
  const lanes = [
    { name: "static file", note: "the host alone, no Roc", url: "/favicon.svg", server: "no Roc" },
    { name: "Roc text", note: "a handler, no template", url: "/race/text" },
    { name: "template", note: "the menu, rendered", url: "/race/page" },
    { name: "SQLite", note: "a query, then text", url: "/race/db" },
    { name: "Datastar", note: "a stream, one patch", url: "/race/patch", server: "streamed" },
  ];
  const rows = lanes.map((lane, i) => {
    const row = document.createElement("div");
    row.className = "lane";
    row.style.setProperty("--lane", `var(--lane-${i})`);
    row.innerHTML = `<div class="who"><b>${lane.name}</b><small>${lane.note}</small></div>` +
      `<div class="road"><span class="bar"></span><span class="rate">–</span></div>` +
      `<div class="stats"><span>p50 <b class="p50">–</b></span><span>p99 <b class="p99">–</b></span>` +
      `<span>server <b class="server">${lane.server ?? "–"}</b></span></div>`;
    $("lanes").append(row);
    return row;
  });
  const rates = lanes.map(() => 0);
  const bars = () => {
    const most = Math.max(1, ...rates);
    rows.forEach((row, i) => { row.querySelector(".bar").style.width = `${(78 * rates[i] / most).toFixed(2)}%`; });
  };
  const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const serverTime = (url) => {
    const entries = performance.getEntriesByName(url);
    return entries[entries.length - 1]?.serverTiming?.find((t) => t.name === "roux")?.duration;
  };

  const race = async (index) => {
    const row = rows[index];
    const url = new URL(lanes[index].url, location.href).href;
    const times = [];
    const servers = [];
    row.classList.add("running");
    const started = performance.now();
    const until = started + 2000;
    const worker = async () => {
      while (performance.now() < until) {
        const from = performance.now();
        const answer = await fetch(url, { cache: "no-store" });
        await answer.arrayBuffer();
        times.push(performance.now() - from);
      }
    };
    const tick = () => {
      rates[index] = times.length / Math.max(0.001, (performance.now() - started) / 1000);
      bars();
      row.querySelector(".rate").textContent = Math.round(rates[index]).toLocaleString() + " req/s";
      const sorted = [...times].sort((a, b) => a - b);
      if (sorted.length) {
        row.querySelector(".p50").textContent = ms(quantile(sorted, 0.5));
        row.querySelector(".p99").textContent = ms(quantile(sorted, 0.99));
      }
      const s = serverTime(url);
      if (s !== undefined) servers.push(s);
      if (servers.length) {
        row.querySelector(".server").textContent = ms([...servers].sort((a, b) => a - b)[servers.length >> 1]);
      }
    };
    performance.setResourceTimingBufferSize(100000);
    const ticker = setInterval(tick, 120);
    await Promise.all(Array.from({ length: 6 }, worker));
    clearInterval(ticker);
    tick();
    row.classList.remove("running");
    performance.clearResourceTimings();
  };

  const sleep = (t) => new Promise((done) => setTimeout(done, t));
  $("go").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const lights = [...$("lights").children];
    button.disabled = true;
    rates.fill(0);
    rows.forEach((row, i) => {
      row.querySelector(".bar").style.width = "0";
      for (const cell of row.querySelectorAll(".rate, .p50, .p99")) cell.textContent = "–";
      row.querySelector(".server").textContent = lanes[i].server ?? "–";
    });
    lights.forEach((light) => light.className = "");
    for (const light of lights) { light.className = "on"; await sleep(320); }
    lights.forEach((light) => light.className = "go");
    for (let i = 0; i < lanes.length; i++) await race(i);
    lights.forEach((light) => light.className = "");
    button.disabled = false;
    button.textContent = "Race again";
  });
})();
