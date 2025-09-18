/* ==========================================================
   SOLGISTICA · app.js (auto-geocodificación + cronograma + descarga directa)
   ========================================================== */

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
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}

/* ---------- DOM ---------- */
const linksTA = $("#links");
const inputTableWrap = $("#inputTableWrap");
const inputTable = $("#inputTable");
const statusEl = $("#status");
const resultsEl = $("#results");

const avgSpeedEl = $("#avgSpeed");
const defaultDwellEl = $("#defaultDwell");
const startTimeEl = $("#startTime");
const defaultOpenEl = $("#defaultOpen");
const defaultCloseEl = $("#defaultClose");
const circularEl = $("#circular");
const enforceWindowsEl = $("#enforceWindows");

/* ---------- Estado ---------- */
const state = {
  rawRows: [],      // [{name,address,lat,lng,prec,dwell,open,close}]
  schedule: [],     // [{idx,name,address,arrive,depart,travelMin,waitMin}]
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
   4) Cronograma
   ========================================================== */
function buildSchedule(rowsInOrder) {
  const speed = Number(avgSpeedEl?.value || 40) || 40;
  const defaultDwell = Number(defaultDwellEl?.value || 10) || 10;
  let nowMin = timeStrToMin(startTimeEl?.value) ?? 8 * 60;

  return rowsInOrder.map((row, i) => {
    let travelMin = 0;
    if (i > 0) {
      const prev = rowsInOrder[i - 1];
      travelMin = (haversine(prev, row) / Math.max(1, speed)) * 60;
    }
    let arrive = nowMin + travelMin;

    const openMin = timeStrToMin(row.open);
    const closeMin = timeStrToMin(row.close);
    let waitMin = 0;
    if (openMin != null && arrive < openMin) {
      waitMin = openMin - arrive;
      arrive = openMin;
    }

    let dwell = Number(row.dwell ?? defaultDwell) || defaultDwell;
    let depart = arrive + dwell;
    if (closeMin != null && depart > closeMin && enforceWindowsEl?.checked) {
      depart = closeMin;
    }

    nowMin = depart;
    return {
      idx: i + 1,
      name: row.name || "",
      address: row.address,
      travelMin: Math.round(travelMin),
      arrive: Math.round(arrive),
      waitMin: Math.round(waitMin),
      depart: Math.round(depart),
    };
  });
}
function renderScheduleTable(schedule) {
  if (!schedule?.length) return "";
  const rows = schedule.map(s => `
    <tr>
      <td class="py-2 px-2">${s.idx}</td>
      <td class="py-2 px-2">${s.name || "-"}</td>
      <td class="py-2 px-2">${s.address}</td>
      <td class="py-2 px-2 whitespace-nowrap">${minToTimeStr(s.arrive)}</td>
      <td class="py-2 px-2 whitespace-nowrap">${minToTimeStr(s.depart)}</td>
      <td class="py-2 px-2">${s.travelMin} min</td>
      <td class="py-2 px-2">${s.waitMin} min</td>
    </tr>`).join("");
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

/* ==========================================================
   5) Flujo principal
   ========================================================== */
async function updateFromText({ optimize = false } = {}) {
  try {
    statusEl.textContent = "Procesando…";

    // 1) Parse
    state.rawRows = parseInputText();
    if (!state.rawRows.length) {
      renderTable();
      resultsEl.innerHTML = `<p class="text-slate-600">Aún sin resultados.</p>`;
      statusEl.textContent = "Pegá direcciones para comenzar.";
      return;
    }

    // 2) Completar defaults de ventanas si faltan
    for (const r of state.rawRows) {
      if (!r.open && defaultOpenEl?.value) r.open = defaultOpenEl.value;
      if (!r.close && defaultCloseEl?.value) r.close = defaultCloseEl.value;
    }

    // 3) Geocodificar
    for (let i = 0; i < state.rawRows.length; i++) {
      const r = state.rawRows[i];
      if (r.lat == null || r.lng == null) {
        const g = await geocode(r.address);
        if (g) Object.assign(r, g);
      }
      statusEl.textContent = `Geocodificando (${i + 1}/${state.rawRows.length})…`;
      await sleep(40);
    }

    renderTable();

    // 4) Cronograma + totales
    state.totalKm = 0;
    for (let i = 0; i < state.rawRows.length - 1; i++) {
      state.totalKm += haversine(state.rawRows[i], state.rawRows[i + 1]);
    }
    state.schedule = buildSchedule(state.rawRows);
    state.totalMin = state.schedule.at(-1)?.depart ?? 0;

    renderResultsSummary({
      stops: state.rawRows.length,
      km: state.totalKm,
      min: state.totalMin,
    });

    statusEl.textContent = optimize ? "Ruta optimizada." : "Listo.";
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Error: " + (e.message || e);
  }
}

/* ==========================================================
   6) Acciones UI
   ========================================================== */
$("#oneClick")?.addEventListener("click", () => updateFromText({ optimize: true }));
$("#updateBtn")?.addEventListener("click", () => updateFromText({ optimize: false }));
$("#clearBtn")?.addEventListener("click", () => {
  if (linksTA) linksTA.value = "";
  state.rawRows = [];
  state.schedule = [];
  renderTable();
  resultsEl.innerHTML = `<p class="text-slate-600">Aún sin resultados.</p>`;
  statusEl.textContent = "Entradas limpiadas.";
});
$("#copyOrder")?.addEventListener("click", async () => {
  if (!state.rawRows.length) return alert("Primero cargá direcciones.");
  const txt = state.rawRows
    .map((r, i) => `${i + 1}. ${r.name ? r.name + " | " : ""}${r.address || ""}`)
    .join("\n");
  await navigator.clipboard.writeText(txt);
  statusEl.textContent = "Orden copiado al portapapeles.";
});
$("#exportCsv")?.addEventListener("click", () => {
  if (!state.rawRows.length) return alert("Primero cargá direcciones.");
  const head = ["orden","local","direccion","lat","lng","precision","dwell","abre","cierra"];
  const csvRows = state.rawRows.map((r, idx) => [
    idx + 1, r.name || "", r.address || "", r.lat ?? "", r.lng ?? "",
    r.prec ?? "", r.dwell ?? "", r.open || "", r.close || ""
  ]);
  const csv =
    head.join(",") + "\n" +
    csvRows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "ruta.csv"; a.click();
  URL.revokeObjectURL(url);
});

/* ==========================================================
   7) Descarga directa de “PDF” (HTML imprimible)
   ========================================================== */
$("#downloadPdf")?.addEventListener("click", () => {
  if (!state.rawRows.length) return alert("Primero cargá direcciones.");
  const schedule = state.schedule?.length ? state.schedule : buildSchedule(state.rawRows);
  downloadScheduleHTML(schedule, { km: state.totalKm || 0, min: state.totalMin || 0 });
});

function downloadScheduleHTML(schedule, totals) {
  const rows = schedule.map(s => `
    <tr>
      <td>${s.idx}</td>
      <td>${s.name ? s.name : "-"}</td>
      <td>${s.address}</td>
      <td style="white-space:nowrap">${minToTimeStr(s.arrive)}</td>
      <td style="white-space:nowrap">${minToTimeStr(s.depart)}</td>
      <td>${s.travelMin} min</td>
      <td>${s.waitMin} min</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Cronograma</title>
<link href="https://fonts.googleapis.com/css2?family=Questrial&display=swap" rel="stylesheet">
<style>
  body{font-family:'Questrial',system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:#0f172a;}
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
    <div class="print-sub">Paradas: ${schedule.length} · Distancia: ${fmt(totals.km,1)} km · Duración: ${fmt(totals.min,0)} min</div>
    <table class="print-table">
      <thead><tr>
        <th>#</th><th>Local</th><th>Dirección</th>
        <th>Llega</th><th>Sale</th><th>Traslado</th><th>Espera</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <script>window.addEventListener('load',()=>window.print());</script>
</body></html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cronograma.html";      // Abrís y guardás como PDF
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ==========================================================
   8) Mensaje inicial
   ========================================================== */
statusEl.textContent = "Listo para usar. Pegá direcciones y optimizá 🚀";
