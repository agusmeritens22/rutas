/* ==========================================================
   SOLGISTICA · app.js (geocodificación automática + cronograma)
   ========================================================== */

/* ---------- Utils ---------- */
const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n, d = 1) =>
  new Intl.NumberFormat("es-AR", { maximumFractionDigits: d }).format(n);

const toRad = (deg) => (deg * Math.PI) / 180;
function haversine(a, b) {
  const R = 6371; // km
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function timeStrToMin(t) {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minToTimeStr(m) {
  m = Math.max(0, Math.round(m));
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}

/* ---------- DOM ---------- */
const linksTA = $("#links");
const inputTableWrap = $("#inputTableWrap");
const inputTable = $("#inputTable");
const statusEl = $("#status");
const resultsEl = $("#results");
const dirLinksEl = $("#dirLinks");

const avgSpeedEl = $("#avgSpeed");
const defaultDwellEl = $("#defaultDwell");
const startTimeEl = $("#startTime");
const defaultOpenEl = $("#defaultOpen");
const defaultCloseEl = $("#defaultClose");
const circularEl = $("#circular");
const enforceWindowsEl = $("#enforceWindows");

/* ---------- Estado ---------- */
const state = {
  rawRows: [], // [{name,address,lat,lng,prec,dwell,open,close}]
  orderedIdx: [],
  schedule: [], // [{idx,name,address,arrive,depart,travelMin,waitMin}]
  totalKm: 0,
  totalMin: 0,
};

/* ==========================================================
   1) Parseo de textarea
   ========================================================== */
function parseInputText() {
  const lines = (linksTA?.value || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const [nameMaybe, addrMaybe] = line.split("|").map((s) => s?.trim());
    return {
      name: nameMaybe && addrMaybe ? nameMaybe : "",
      address: addrMaybe || line,
      dwell: Number(defaultDwellEl?.value || 10) || 10,
      open: defaultOpenEl?.value || "",
      close: defaultCloseEl?.value || "",
    };
  });
}

/* ==========================================================
   2) Geocoder (OpenCage)
   ========================================================== */
async function geocode(address) {
  const key = window.GEOCODER?.key;
  if (!key) throw new Error("Falta window.GEOCODER.key");
  const url =
    "https://api.opencagedata.com/geocode/v1/json?no_annotations=1&language=es&limit=1&q=" +
    encodeURIComponent(address) +
    "&key=" +
    encodeURIComponent(key);
  const r = await fetch(url);
  if (!r.ok) throw new Error("Geocoder HTTP " + r.status);
  const j = await r.json();
  const it = j.results?.[0];
  if (!it) return null;
  const { lat, lng } = it.geometry;
  const prec = it.confidence ?? 0;
  return { lat: Number(lat), lng: Number(lng), prec };
}

/* ==========================================================
   3) Render de tabla (Puntos detectados)
   ========================================================== */
function renderTable() {
  if (!inputTableWrap || !inputTable) return;
  if (!state.rawRows.length) {
    inputTableWrap.classList.add("hidden");
    inputTable.innerHTML = "";
    return;
  }
  inputTableWrap.classList.remove("hidden");

  inputTable.innerHTML = state.rawRows
    .map((r, i) => {
      const nameVal = (r.name || "").replaceAll('"', "&quot;");
      const addrVal = (r.address || "").replaceAll('"', "&quot;");
      const latVal = r.lat?.toFixed?.(6) ?? "";
      const lngVal = r.lng?.toFixed?.(6) ?? "";
      const precTxt = r.prec ? (r.prec >= 8 ? "Exacta" : "Aprox.") : "";

      return `
<tr class="bg-white">
  <td class="py-3 px-4">${i + 1}</td>
  <td class="py-3 px-4">
    <input data-k="name" data-i="${i}" value="${nameVal}"
      class="w-full px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>
  <td class="py-3 px-4 w-full">
    <input data-k="address" data-i="${i}" value="${addrVal}"
      class="w-full px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>
  <td class="py-3 px-4 mono">${latVal}</td>
  <td class="py-3 px-4 mono">${lngVal}</td>
  <td class="py-3 px-4 ${precTxt === "Exacta" ? "text-emerald-700" : "text-amber-600"}">${precTxt}</td>
  <td class="py-3 px-4">
    <input data-k="dwell" data-i="${i}" type="number" min="0" step="1" value="${r.dwell ?? 10}"
      class="w-24 px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>
  <td class="py-3 px-4">
    <input data-k="open" data-i="${i}" type="time" value="${r.open || ""}"
      class="px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>
  <td class="py-3 px-4">
    <input data-k="close" data-i="${i}" type="time" value="${r.close || ""}"
      class="px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>
</tr>`;
    })
    .join("");

  // bind cambios
  inputTable.querySelectorAll("input[data-k]").forEach((el) => {
    el.addEventListener("change", () => {
      const i = Number(el.dataset.i);
      const k = el.dataset.k;
      let v = el.value;
      if (k === "dwell") v = Number(v) || 0;
      state.rawRows[i][k] = v;
    });
  });
}

/* ==========================================================
   4) Resultados + Cronograma
   ========================================================== */
function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg;
}
function renderResultsSummary({ stops, km, min }) {
  if (!resultsEl) return;
  const head = `
    <div>Paradas: <strong>${stops}</strong></div>
    <div>Distancia estimada: <strong>${fmt(km, 1)} km</strong></div>
    <div>Duración total: <strong>${fmt(min, 0)} min</strong></div>
  `;
  const sched = renderScheduleTable(state.schedule || []);
  resultsEl.innerHTML = head + (sched ? `<div class="mt-3">${sched}</div>` : "");
}
function renderScheduleTable(schedule) {
  if (!schedule?.length) return "";
  const rows = schedule
    .map(
      (s) => `
      <tr>
        <td class="py-2 px-2">${s.idx}</td>
        <td class="py-2 px-2">${s.name || "-"}</td>
        <td class="py-2 px-2">${s.address}</td>
        <td class="py-2 px-2 whitespace-nowrap">${minToTimeStr(s.arrive)}</td>
        <td class="py-2 px-2 whitespace-nowrap">${minToTimeStr(s.depart)}</td>
        <td class="py-2 px-2">${s.travelMin} min</td>
        <td class="py-2 px-2">${s.waitMin} min</td>
      </tr>`
    )
    .join("");
  return `
    <div class="rounded-lg border border-slate-200 overflow-hidden">
      <table class="w-full text-xs sm:text-sm">
        <thead class="bg-slate-50 text-slate-600">
          <tr>
            <th class="py-2 px-2 text-left">#</th>
            <th class="py-2 px-2 text-left">Local</th>
            <th class="py-2 px-2 text-left">Dirección</th>
            <th class="py-2 px-2 text-left">Llega</th>
            <th class="py-2 px-2 text-left">Sale</th>
            <th class="py-2 px-2 text-left">Traslado</th>
            <th class="py-2 px-2 text-left">Espera</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ==========================================================
   5) Optimización simple (Nearest Neighbor)
   ========================================================== */
function nearestNeighbor(points, startIdx = 0, circular = false) {
  const n = points.length;
  if (n <= 1) return [...Array(n).keys()];
  const used = new Array(n).fill(false);
  const order = [];
  let cur = startIdx;
  order.push(cur);
  used[cur] = true;
  for (let step = 1; step < n; step++) {
    let best = -1,
      bestD = 1e9;
    for (let j = 0; j < n; j++) {
      if (used[j]) continue;
      const d = haversine(points[cur], points[j]);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    cur = best;
    used[cur] = true;
    order.push(cur);
  }
  if (circular) order.push(order[0]);
  return order;
}
function calcDistanceAndTime(order, pts, speedKmh, dwellMin) {
  let km = 0,
    min = 0;
  for (let i = 0; i < order.length - 1; i++) {
    const a = pts[order[i]],
      b = pts[order[i + 1]];
    const d = haversine(a, b);
    km += d;
    min += (d / Math.max(1, speedKmh)) * 60;
    min += dwellMin;
  }
  if (order.length) min += dwellMin;
  return { km, min };
}

/* ==========================================================
   6) Cronograma (con ventanas simples)
   ========================================================== */
function buildSchedule(rowsInOrder) {
  const speed = Number(avgSpeedEl?.value || 40) || 40;
  const defaultDwell = Number(defaultDwellEl?.value || 10) || 10;
  let nowMin = timeStrToMin(startTimeEl?.value) ?? 8 * 60;

  const sched = [];
  for (let i = 0; i < rowsInOrder.length; i++) {
    let travelMin = 0;
    if (i > 0) {
      const prev = rowsInOrder[i - 1],
        cur = rowsInOrder[i];
      travelMin = (haversine(prev, cur) / Math.max(1, speed)) * 60;
    }
    let arrive = nowMin + travelMin;

    const openMin = timeStrToMin(rowsInOrder[i].open);
    const closeMin = timeStrToMin(rowsInOrder[i].close);
    let waitMin = 0;
    if (openMin != null && arrive < openMin) {
      waitMin = openMin - arrive;
      arrive = openMin;
    }

    let dwell = Number(rowsInOrder[i].dwell ?? defaultDwell) || defaultDwell;
    let depart = arrive + dwell;

    if (closeMin != null && depart > closeMin && enforceWindowsEl?.checked) {
      // si no cabe dentro de ventana, igual marcamos tope
      depart = closeMin;
    }

    sched.push({
      idx: i + 1,
      name: rowsInOrder[i].name || "",
      address:
        rowsInOrder[i].address ||
        `${rowsInOrder[i].lat},${rowsInOrder[i].lng}`,
      travelMin: Math.round(travelMin),
      arrive: Math.round(arrive),
      waitMin: Math.round(waitMin),
      depart: Math.round(depart),
    });

    nowMin = depart;
  }
  return sched;
}

/* ==========================================================
   7) Google Maps helpers (enlaces por tramo + publicación)
   ========================================================== */
function publishToGMaps(rowsInOrder) {
  const pts = (rowsInOrder || [])
    .map((r) => {
      const hasAddr = typeof r.address === "string" && r.address.trim().length > 0;
      const hasCoords = typeof r.lat === "number" && typeof r.lng === "number";
      if (hasAddr) return { addrefunction pointToStr(p){
  if (!p) return "";
  if (typeof p.address === "string" && p.address.trim().length > 0) return p.address.trim();
  if (typeof p.lat === "number" && typeof p.lng === "number") return `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  return "";
}
function makeMapsUrlPath(points){
  const parts = (points || []).map(pointToStr).filter(Boolean).map(encodeURIComponent);
  if (parts.length === 1) parts.push(parts[0]);
  return `/dir/${parts.join('/')}`;
}
function buildFullRouteChunks(points){
  const clean = (points || []).map(pointToStr).filter(Boolean);
  if (clean.length < 2) return [];
  const maxPerUrl = 10; // origin + up to 9 more
  const out = [];
  let start = 0, idx = 1;
  while (start < clean.length - 1) {
    const end = Math.min(start + maxPerUrl - 1, clean.length - 1);
    const slice = clean.slice(start, end + 1);
    if (slice.length >= 2) {
      const url = "https://www.google.com/maps" + "/dir/" + slice.map(encodeURIComponent).join('/');
      out.push({ idx, range: [start + 1, end + 1], url });
      idx++;
    }
    start = end;
  }
  return out;
}
function renderDirLinks(rowsInOrder = []) {
  if (!dirLinksEl) return;
  const points = (rowsInOrder || []).map(r => {
    const hasAddr = typeof r.address === "string" && r.address.trim().length > 0;
    const hasCoords = typeof r.lat === "number" && typeof r.lng === "number";
    if (hasAddr) return { address: r.address.trim() };
    if (hasCoords) return { lat: r.lat, lng: r.lng };
    return null;
  }).filter(Boolean);

  if (!points.length) {
    dirLinksEl.innerHTML = `<p class="text-slate-700">Sin tramos aún.</p>`;
    return;
  }

  // Links por tramo (validar que existan ambos extremos)
  const legs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const A = points[i], B = points[i+1];
    const sA = pointToStr(A), sB = pointToStr(B);
    if (!sA || !sB) continue;
    const url = "https://www.google.com/maps/dir/" + [sA, sB].map(encodeURIComponent).join('/');
    legs.push({i: i+1, url, from: sA, to: sB});
  }

  // Ruta completa en chunks de hasta 10 puntos
  const full = buildFullRouteChunks(points);

  dirLinksEl.innerHTML = `
    <div class="space-y-2">
      ${full.length ? `
      <div class="text-sm font-semibold">Ruta completa</div>
      <div class="flex flex-col gap-1">
        ${full.map(c => `<a class="underline text-sky-800" target="_blank" rel="noopener" href="${c.url}">Ruta ${c.idx} (${c.range[0]}–${c.range[1]})</a>`).join('')}
      </div>` : ``}
      <div class="text-xs text-slate-500 mt-1">Abrir por tramos:</div>
      <div class="flex flex-col gap-1">
        ${legs.map(l => `<a class="underline text-sky-800" target="_blank" rel="noopener" href="${l.url}">Tramo ${l.i}: ${l.from} → ${l.to}</a>`).join('')}
      </div>
    </div>`;
}
