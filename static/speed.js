// The Speed page: save-to-screen timing, and a drag race in the browser.
// roux dev tells this page two things: when a new build serves (the
// /_dev/events stream) and what its last pass cost (/_dev/stats); each
// answer's Server-Timing header says the app's own time.
(() => {
  const $ = (name) => document.querySelector(`[data-roux="${name}"]`);
  const told = "roux-speed:told";
  const kept = "roux-speed:history";
  const ms = (x) => (x < 1 ? x.toFixed(2) : x < 10 ? x.toFixed(1) : Math.round(x)) + " ms";
  const load = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  };

  // ── Save to screen ──────────────────────────────────────────────────────
  // When the stream names a new build, the time is kept: the page is about
  // to reload (roux's own script does that), and the next load measures.
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
    setTimeout(() => done(performance.now()), 1000);
  });

  const history = load(kept, []);
  const drawHistory = () => {
    const most = Math.max(1, ...history.map((h) => h.total));
    $("history").innerHTML = history.map((h) =>
      `<li style="--w:${(100 * h.total / most).toFixed(1)}%"><span></span>${ms(h.total)}</li>`).join("");
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
    if (stats.built !== "templates") {
      $("roc").textContent = `roc compiled it and the app restarted: ${ms(stats.micros / 1000)} last time`;
    }
    const at = Number(sessionStorage.getItem(told));
    sessionStorage.removeItem(told);
    if (at && stats.built === "templates") {
      const server = stats.micros / 1000;
      const browser = performance.timeOrigin + (await painted()) - at;
      const total = server + browser;
      $("server").textContent = ms(server);
      $("browser").textContent = ms(browser);
      $("total").textContent = ms(total);
      history.unshift({ server, browser, total });
      history.length = Math.min(history.length, 8);
      try { localStorage.setItem(kept, JSON.stringify(history)); } catch {}
      $("note").textContent = "Save again: the last eight are kept below.";
    } else if (history.length > 0) {
      const last = history[0];
      $("server").textContent = ms(last.server);
      $("browser").textContent = ms(last.browser);
      $("total").textContent = ms(last.total);
      $("note").textContent = "Your last edits, newest first. Save again to add one.";
    }
    drawHistory();
  })();

  // ── The drag race ───────────────────────────────────────────────────────
  const lanes = [
    { name: "static file", note: "served by the host, no Roc", url: "/favicon.svg" },
    { name: "Roc, plain text", note: "a handler, no template", url: "/race/text" },
    { name: "a template", note: "the menu, rendered", url: "/race/page" },
    { name: "SQLite read", note: "a query, then text", url: "/race/db" },
    { name: "Datastar patch", note: "a stream, one event", url: "/race/patch" },
  ];
  const rows = lanes.map((lane) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td><b>${lane.name}</b><small>${lane.note}</small></td>` +
      `<td class="bar"><span></span></td><td>–</td><td>–</td><td>–</td><td>–</td>`;
    $("lanes").append(row);
    return row;
  });
  const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const serverTime = (url) => {
    const entries = performance.getEntriesByName(new URL(url, location.href).href);
    const entry = entries[entries.length - 1];
    return entry?.serverTiming?.find((t) => t.name === "roux")?.duration;
  };

  const rates = lanes.map(() => 0);
  const bars = () => {
    const most = Math.max(1, ...rates);
    rows.forEach((row, i) => {
      row.querySelector(".bar span").style.width = `${(100 * rates[i] / most).toFixed(1)}%`;
    });
  };

  const race = async (index) => {
    const lane = lanes[index];
    const row = rows[index];
    const times = [];
    const servers = [];
    const until = performance.now() + 2000;
    const url = new URL(lane.url, location.href).href;
    const worker = async () => {
      while (performance.now() < until) {
        const from = performance.now();
        const answer = await fetch(url, { cache: "no-store" });
        await answer.arrayBuffer();
        times.push(performance.now() - from);
      }
    };
    const show = () => {
      const sorted = [...times].sort((a, b) => a - b);
      const rate = times.length / Math.max(0.001, (performance.now() - started) / 1000);
      const cells = row.querySelectorAll("td");
      rates[index] = rate;
      bars();
      cells[2].textContent = Math.round(rate).toLocaleString();
      if (sorted.length) {
        cells[3].textContent = ms(quantile(sorted, 0.5));
        cells[4].textContent = ms(quantile(sorted, 0.99));
      }
      const s = serverTime(url);
      if (s !== undefined) servers.push(s);
      if (servers.length) cells[5].textContent = ms(servers.sort((a, b) => a - b)[servers.length >> 1]);
    };
    const started = performance.now();
    performance.setResourceTimingBufferSize(100000);
    const ticker = setInterval(show, 150);
    await Promise.all(Array.from({ length: 6 }, worker));
    clearInterval(ticker);
    show();
    performance.clearResourceTimings();
  };

  $("go").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Racing…";
    rates.fill(0);
    for (let i = 0; i < lanes.length; i++) await race(i);
    button.disabled = false;
    button.textContent = "Race again";
  });
})();
