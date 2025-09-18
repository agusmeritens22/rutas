/* ==========================================================
   SOLGISTICA · app.js corregido (final)
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
const resultsEl = $("#results");

const avgSpeedEl = $("#avgSpeed");
const defaultDwellEl = $("#defaultDwell");
const startTimeEl = $("#startTime");
const defaultOpenEl = $("#defaultOpen");
const defaultCloseEl = $("#defaultClose");
const circularEl = $("#circular");
const enforceWindowsEl = $("#enforceWindows");
const useGeoEl = $("#useGeo");
const dirLinksEl = $("#dirLinks");

/* ---------- Estado ---------- */
const state = {
  rawRows: [],
  schedule: [],
  totalKm: 0,
  totalMin: 0,
};

/* ==========================================================
   Geocoder (OpenCage)
   ========================================================== */
async function geocode(address) {
  const key = window.GEOCODER?.key;
  const url =
    "https://api.opencagedata.com/geocode/v1/json?no_annotations=1&language=es&limit=1&q=" +
    encodeURIComponent(address) +
    "&key=" +
    encodeURIComponent(key);
  const r = await fetch(url);
  const j = await r.json();
  const it = j.results?.[0];
  if (!it) return null;
  const { lat, lng } = it.geometry;
  const prec = it.confidence ?? 0;
  return { lat: Number(lat), lng: Number(lng), prec };
}

/* ==========================================================
   Parseo de textarea
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
   Render de tabla
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
   Cronograma
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
   Enlaces de navegación (Google Maps)
   ========================================================== */
function pointToStr(p){
  if (p?.address) return p.address;
  if (p?.lat != null && p?.lng != null) return `${p.lat},${p.lng}`;
  return '';
}
function makeMapsUrl(points){
  const parts = points.map(pointToStr).filter(Boolean).map(encodeURIComponent);
  return `https://www.google.com/maps/dir/${parts.join('/')}`;
}
function perLegLinks(points){
  const out = [];
  for (let i=0;i<points.length-1;i++){
    const a = points[i], b = points[i+1];
    const url = makeMapsUrl([a,b]);
    out.push({i:i+1, from: pointToStr(a), to: pointToStr(b), url});
  }
  return out;
}
async function getStartGeoIfNeeded(){
  if (!useGeoEl?.checked) return null;
  try{
    const pos = await new Promise((res,rej)=>{
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy:true, timeout:8000 });
    });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, address: null, name: 'Inicio (mi ubicación)' };
  }catch{ return null; }
}
async function updateNavLinksAndAPI(points){
  if (typeof window.setOptimizedPoints === 'function'){
    window.setOptimizedPoints(points);
  }
  if (!dirLinksEl) return;
  const fullUrl = makeMapsUrl(points);
  const legs = perLegLinks(points);
  dirLinksEl.innerHTML = `
    <div class="space-y-2">
      <a href="${fullUrl}" target="_blank" rel="noopener" class="underline text-sky-700">Abrir ruta completa</a>
      <div class="text-xs text-slate-500">O abrir por tramos:</div>
      <div class="flex flex-col gap-1">
        ${legs.map(l => `
          <a class="text-sm underline text-sky-700" target="_blank" rel="noopener"
             href="${l.url}">Tramo ${l.i}: ${l.from || '(origen)'} → ${l.to}</a>
        `).join('')}
      </div>
    </div>`;
}

/* ==========================================================
   Flujo principal
   ========================================================== */
async function updateFromText() {
  try {
    state.rawRows = parseInputText();
    if (!state.rawRows.length) {
      renderTable();
      resultsEl.innerHTML = `<p class="text-slate-700">Aún sin resultados.</p>`;
      if (dirLinksEl) dirLinksEl.innerHTML = `<p>Se generan links a Google Maps por tramos.</p>`;
      return;
    }

    // Geocodificar
    for (let r of state.rawRows) {
      if (!r.lat || !r.lng) {
        const g = await geocode(r.address);
        if (g) Object.assign(r, g);
        await sleep(40);
      }
    }

    renderTable();

    // Cronograma
    state.schedule = buildSchedule(state.rawRows);
    state.totalKm = 0;
    for (let i = 0; i < state.rawRows.length - 1; i++) {
      state.totalKm += haversine(state.rawRows[i], state.rawRows[i + 1]);
    }
    state.totalMin = state.schedule.at(-1)?.depart ?? 0;

    renderResultsSummary({
      stops: state.rawRows.length,
      km: state.totalKm,
      min: state.totalMin,
    });

    // Generar enlaces de navegación
    let points = state.rawRows.slice();
    if (circularEl?.checked && points.length > 1){
      points.push(points[0]); // ruta circular
    }
    const startGeo = await getStartGeoIfNeeded();
    if (startGeo) points = [startGeo, ...points];
    await updateNavLinksAndAPI(points);

  } catch (e) {
    console.error(e);
  }
}

/* ==========================================================
   Acciones UI
   ========================================================== */
$("#updateBtn")?.addEventListener("click", () => updateFromText());
$("#oneClick")?.addEventListener("click", () => updateFromText());
$("#clearBtn")?.addEventListener("click", () => {
  if (linksTA) linksTA.value = "";
  state.rawRows = [];
  state.schedule = [];
  renderTable();
  resultsEl.innerHTML = `<p class="text-slate-700">Aún sin resultados.</p>`;
  if (dirLinksEl) dirLinksEl.innerHTML = `<p>Se generan links a Google Maps por tramos.</p>`;
});
$("#copyOrder")?.addEventListener("click", async () => {
  if (!state.rawRows.length) return alert("Primero cargá direcciones.");
  const txt = state.rawRows
    .map((r, i) => `${i + 1}. ${r.name ? r.name + " | " : ""}${r.address || ""}`)
    .join("\n");
  await navigator.clipboard.writeText(txt);
});
$("#exportCsv")?.addEventListener("click", () => {
  if (!state.rawRows.length) return alert("Primero cargá direcciones.");
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
  const csvRows = state.rawRows.map((r, idx) => [
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
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ruta.csv";
  a.click();
  URL.revokeObjectURL(url);
});
$("#downloadPdf")?.addEventListener("click", () => {
  if (!state.rawRows.length) return alert("Primero cargá direcciones.");
  const schedule = state.schedule?.length
    ? state.schedule
    : buildSchedule(state.rawRows);
  const totals = { km: state.totalKm || 0, min: state.totalMin || 0 };
  openSchedulePrint(schedule, totals);
});

/* ==========================================================
   Export PDF con jsPDF + autoTable
   ========================================================== */
function openSchedulePrint(schedule, totals) {
  if (!schedule || !schedule.length) {
    alert('No hay cronograma para exportar.');
    return;
  }

  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert('No se encontró jsPDF. Verificá que el <script> de jsPDF y autoTable estén incluidos en index.html.');
    return;
  }

  const orientation = 'portrait'; // 'landscape' si preferís horizontal
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation });

  const km  = (typeof totals?.km  === 'number') ? totals.km  : (state.totalKm || 0);
  const min = (typeof totals?.min === 'number') ? totals.min : (state.totalMin || 0);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Cronograma', 10, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Paradas: ${schedule.length} · Distancia: ${fmt(km,1)} km · Duración: ${fmt(min,0)} min`, 10, 20);

  const head = [['#','Local','Dirección','Llega','Sale','Traslado','Espera']];
  const body = schedule.map(s => [
    String(s.idx),
    s.name ? s.name : '-',
    s.address,
    minToTimeStr(s.arrive),
    minToTimeStr(s.depart),
    `${s.travelMin} min`,
    `${s.waitMin} min`
  ]);

  doc.autoTable({
    head,
    body,
    startY: 26,
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, valign: 'middle' },
    headStyles: { fillColor: [248, 250, 252], textColor: [15, 23, 42] },
    bodyStyles: { textColor: [15, 23, 42] },
    theme: 'grid',
    pageBreak: 'auto',
    tableWidth: 'auto',
    columnStyles: {
      0: { cellWidth: 10 },
      3: { cellWidth: 18 },
      4: { cellWidth: 18 },
      5: { cellWidth: 24 },
      6: { cellWidth: 18 },
    },
    didDrawPage: (data) => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const subtitle = `Paradas: ${schedule.length} · Distancia: ${fmt(km,1)} km · Duración: ${fmt(min,0)} min`;
      doc.text(subtitle, 10, 20);
    },
  });

  doc.save('cronograma.pdf');
}

