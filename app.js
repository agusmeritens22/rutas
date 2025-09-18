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
  <td class="py-4 px-5">
  <input data-k="name" data-i="${i}" value="${nameVal}"
    class="w-full px-4 py-3 text-[15px] font-medium rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
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
  const pts = (rowsInOrder || []).map((r) =>
    r.address ? { address: r.address } : { lat: r.lat, lng: r.lng }
  );
  if (typeof window.setOptimizedPoints === "function")
    window.setOptimizedPoints(pts);
  else window._optimizedPoints = pts;
}
function renderDirLinks(rowsInOrder = []) {
  if (!dirLinksEl) return;
  if (!rowsInOrder.length) {
    dirLinksEl.innerHTML = `<p class="text-slate-700">Sin tramos aún.</p>`;
    return;
  }
  const items = [];
  for (let i = 0; i < rowsInOrder.length - 1; i++) {
    const A = rowsInOrder[i],
      B = rowsInOrder[i + 1];
    const o = A.address || `${A.lat},${A.lng}`;
    const d = B.address || `${B.lat},${B.lng}`;
    const url =
      "https://www.google.com/maps/dir/?api=1&origin=" +
      encodeURIComponent(o) +
      "&destination=" +
      encodeURIComponent(d);
    items.push(
      `<a class="underline text-sky-800" target="_blank" href="${url}">Tramo ${
        i + 1
      }</a>`
    );
  }
  dirLinksEl.innerHTML = `<div class="flex flex-wrap gap-2">${items.join(
    ""
  )}</div>`;
}

/* ==========================================================
   8) Flujo principal
   ========================================================== */
async function updateFromText({ optimize = false } = {}) {
  try {
    setStatus("Procesando entradas…");

    // 1) Parse
    state.rawRows = parseInputText();
    if (!state.rawRows.length) {
      renderTable();
      setStatus("Pegá direcciones y volvé a intentar.");
      resultsEl &&
        (resultsEl.innerHTML = `<p class="text-slate-700">Aún sin resultados.</p>`);
      return;
    }

    // 2) Geocodificar todas las filas sin lat/lng
    for (let i = 0; i < state.rawRows.length; i++) {
      const r = state.rawRows[i];
      if (r.lat == null || r.lng == null) {
        const g = await geocode(r.address);
        if (g) Object.assign(r, g);
      }
      setStatus(`Geocodificando (${i + 1}/${state.rawRows.length})…`);
      await sleep(40);
    }

    renderTable();

    // 3) Orden base
    let rowsInOrder = [...state.rawRows];
    if (optimize) {
      const pts = rowsInOrder.map((r) => ({ lat: r.lat, lng: r.lng }));
      const order = nearestNeighbor(pts, 0, circularEl?.checked);
      state.orderedIdx = order;
      rowsInOrder = order.map((i) => state.rawRows[i]);
    } else {
      state.orderedIdx = [];
    }

    // 4) Distancia/tiempo total (aprox por velocidad)
    const speed = Number(avgSpeedEl?.value || 40) || 40;
    const dwell = Number(defaultDwellEl?.value || 10) || 10;
    const orderIdx = state.orderedIdx.length
      ? state.orderedIdx
      : rowsInOrder.map((_, i) => i);
    const pts = rowsInOrder.map((r) => ({ lat: r.lat, lng: r.lng }));
    const { km, min } = calcDistanceAndTime(orderIdx, pts, speed, dwell);
    state.totalKm = km;
    state.totalMin = min;

    // 5) Cronograma
    state.schedule = buildSchedule(rowsInOrder);

    // 6) Publicar integraciones y mostrar resultados
    publishToGMaps(rowsInOrder);
    renderDirLinks(rowsInOrder);
    renderResultsSummary({ stops: rowsInOrder.length, km, min });
    setStatus(optimize ? "Ruta optimizada." : "Listo. Podés optimizar cuando quieras.");
  } catch (e) {
    console.error(e);
    setStatus("Error: " + (e.message || e));
  }
}

/* ==========================================================
   9) Acciones UI
   ========================================================== */
$("#oneClick")?.addEventListener("click", () =>
  updateFromText({ optimize: true })
);
$("#updateBtn")?.addEventListener("click", () =>
  updateFromText({ optimize: false })
);
$("#clearBtn")?.addEventListener("click", () => {
  if (linksTA) linksTA.value = "";
  state.rawRows = [];
  state.orderedIdx = [];
  state.schedule = [];
  renderTable();
  setStatus("Entradas limpiadas.");
  resultsEl &&
    (resultsEl.innerHTML = `<p class="text-slate-700">Aún sin resultados.</p>`);
  dirLinksEl &&
    (dirLinksEl.innerHTML = `<p>Se generan links a Google Maps por tramos.</p>`);
});

/* Copiar orden */
$("#copyOrder")?.addEventListener("click", async () => {
  try {
    const rows =
      state.orderedIdx.length > 0
        ? state.orderedIdx.map((i) => state.rawRows[i])
        : state.rawRows;
    if (!rows.length) return alert("Primero cargá direcciones.");
    const txt = rows
      .map(
        (r, i) => `${i + 1}. ${r.name ? r.name + " | " : ""}${r.address || ""}`
      )
      .join("\n");
    await navigator.clipboard.writeText(txt);
    setStatus("Orden copiado al portapapeles.");
  } catch (e) {
    setStatus("No se pudo copiar: " + (e.message || e));
  }
});

/* Export CSV */
$("#exportCsv")?.addEventListener("click", () => {
  const rows =
    state.orderedIdx.length > 0
      ? state.orderedIdx.map((i) => state.rawRows[i])
      : state.rawRows;
  if (!rows.length) return alert("Primero cargá direcciones.");
  const head = [
    "orden",
    "local",
    "direccion",
    "lat",
    "lng",
    "precision",
    "dwell",
    "abre",
    "cierra",
  ];
  const csvRows = rows.map((r, idx) => [
    idx + 1,
    r.name || "",
    r.address || "",
    r.lat ?? "",
    r.lng ?? "",
    r.prec ?? "",
    r.dwell ?? "",
    r.open || "",
    r.close || "",
  ]);
  const csv =
    head.join(",") +
    "\n" +
    csvRows
      .map((r) =>
        r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ruta.csv";
  a.click();
  URL.revokeObjectURL(url);
});

/* Descargar PDF del cronograma (si existe el botón en tu index) */
$("#downloadPdf")?.addEventListener("click", () => {
  const rows =
    state.orderedIdx.length > 0
      ? state.orderedIdx.map((i) => state.rawRows[i])
      : state.rawRows;
  if (!rows.length) return alert("Primero cargá direcciones.");

  const schedule = state.schedule?.length
    ? state.schedule
    : buildSchedule(rows);

  const totals = { km: state.totalKm || 0, min: state.totalMin || 0 };
  openSchedulePrint(schedule, totals);
});

/* Ventana imprimible del cronograma */
function openSchedulePrint(schedule, totals) {
  const win = window.open("", "_blank", "noopener,noreferrer");
  const rows = schedule
    .map(
      (s) => `
    <tr>
      <td>${s.idx}</td>
      <td>${s.name ? s.name : "-"}</td>
      <td>${s.address}</td>
      <td style="white-space:nowrap">${minToTimeStr(s.arrive)}</td>
      <td style="white-space:nowrap">${minToTimeStr(s.depart)}</td>
      <td>${s.travelMin} min</td>
      <td>${s.waitMin} min</td>
    </tr>`
    )
    .join("");

  win.document.write(`
<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Cronograma</title>
<link href="https://fonts.googleapis.com/css2?family=Questrial&display=swap" rel="stylesheet">
<style>
  body{font-family:'Questrial', system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color:#0f172a;}
  .print-container{padding:24px;}
  .print-title{font-size:20px;font-weight:700;margin-bottom:8px;}
  .print-sub{color:#475569;margin-bottom:16px;}
  .print-table{width:100%;border-collapse:collapse;font-size:12px;}
  .print-table th,.print-table td{border:1px solid #e2e8f0;padding:8px;text-align:left;}
  .print-table th{background:#f8fafc;}
</style>
</head>
<body>
  <div class="print-container">
    <div class="print-title">Cronograma</div>
    <div class="print-sub">Paradas: ${schedule.length} · Distancia estimada: ${fmt(totals.km,1)} km · Duración: ${fmt(totals.min,0)} min</div>
    <table class="print-table">
      <thead><tr>
        <th>#</th><th>Local</th><th>Dirección</th>
        <th>Llega</th><th>Sale</th><th>Traslado</th><th>Espera</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <script>window.addEventListener('load',()=>window.print());</script>
</body></html>`);
  win.document.close();
}

/* ==========================================================
   10) Arranque
   ========================================================== */
setStatus("Listo para usar. Pegá direcciones y optimizá 🚀");
