/* ==========================================================
   SOLGISTICA · app.js (versión compacta funcional)
   ========================================================== */

/// ---------- Utilidades generales ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmt = (n, d = 1) =>
  new Intl.NumberFormat("es-AR", { maximumFractionDigits: d }).format(n);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hav = (deg) => (deg * Math.PI) / 180;
function haversine(a, b) {
  const R = 6371; // km
  const dLat = hav(b.lat - a.lat);
  const dLng = hav(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(hav(a.lat)) * Math.cos(hav(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function timeStrToMin(t) {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minToTimeStr(m) {
  m = Math.max(0, Math.floor(m));
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}

/// ---------- DOM refs ----------
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
const autoRunEl = $("#autoRun");
const useGeoEl = $("#useGeo");
const circularEl = $("#circular");
const enforceWindowsEl = $("#enforceWindows");

/// ---------- Estado de la app ----------
const state = {
  rawRows: [], // [{name,address,lat,lng,prec,dwell,open,close}]
  orderedIdx: [], // orden resultante (índices sobre rawRows)
  totalKm: 0,
  totalMin: 0,
};

/// ---------- OpenCage geocoding ----------
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
  const item = j.results?.[0];
  if (!item) return null;
  const { lat, lng } = item.geometry;
  const prec = item.confidence ?? 0;
  return { lat: Number(lat), lng: Number(lng), prec };
}

/// ---------- Parser de textarea ----------
function parseInputText() {
  const lines = linksTA.value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const rows = lines.map((line) => {
    const [nameMaybe, addrMaybe] = line.split("|").map((s) => s?.trim());
    if (addrMaybe) {
      return {
        name: nameMaybe || "",
        address: addrMaybe,
        dwell: Number(defaultDwellEl.value || 10) || 10,
        open: defaultOpenEl.value || "",
        close: defaultCloseEl.value || "",
      };
    }
    return {
      name: "",
      address: line,
      dwell: Number(defaultDwellEl.value || 10) || 10,
      open: defaultOpenEl.value || "",
      close: defaultCloseEl.value || "",
    };
  });
  return rows;
}

/// ---------- Render de tabla ----------
function renderTable() {
  if (!state.rawRows.length) {
    inputTableWrap.classList.add("hidden");
    inputTable.innerHTML = "";
    return;
  }
  inputTableWrap.classList.remove("hidden");
  inputTable.innerHTML = state.rawRows
    .map((r, i) => {
      return `
      <tr>
        <td class="py-2 pr-3">${i + 1}</td>
        <td class="py-2 pr-3"><input data-k="name" data-i="${i}" value="${(r.name || "")
          .replaceAll('"', "&quot;")}" class="w-40"/></td>
        <td class="py-2 pr-3"><input data-k="address" data-i="${i}" value="${(r.address || "")
          .replaceAll('"', "&quot;")}" class="w-72"/></td>
        <td class="py-2 pr-3 mono">${r.lat?.toFixed?.(5) ?? ""}</td>
        <td class="py-2 pr-3 mono">${r.lng?.toFixed?.(5) ?? ""}</td>
        <td class="py-2 pr-3">${r.prec ? "Aprox." : ""}</td>
        <td class="py-2 pr-3"><input data-k="dwell" data-i="${i}" type="number" min="0" step="1" value="${r.dwell ?? 10}" class="w-20"/></td>
        <td class="py-2 pr-3"><input data-k="open" data-i="${i}" type="time" value="${r.open || ""}" class="w-24"/></td>
        <td class="py-2 pr-3"><input data-k="close" data-i="${i}" type="time" value="${r.close || ""}" class="w-24"/></td>
      </tr>`;
    })
    .join("");

  // bind cambios
  inputTable.querySelectorAll("input[data-k]").forEach((el) => {
    el.addEventListener("change", (e) => {
      const i = Number(el.dataset.i);
      const k = el.dataset.k;
      let v = el.value;
      if (k === "dwell") v = Number(v) || 0;
      state.rawRows[i][k] = v;
    });
  });
}

/// ---------- Mensajes ----------
function setStatus(msg) {
  statusEl.textContent = msg;
}
function setResults({ stops, km, min }) {
  resultsEl.innerHTML = `
    <div>Paradas: <strong>${stops}</strong></div>
    <div>Distancia estimada: <strong>${fmt(km, 1)} km</strong></div>
    <div>Duración total: <strong>${fmt(min, 0)} min</strong></div>
  `;
}

/// ---------- Optimización (Nearest-Neighbor básico) ----------
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
  let km = 0;
  let min = 0;
  for (let i = 0; i < order.length - 1; i++) {
    const a = pts[order[i]];
    const b = pts[order[i + 1]];
    km += haversine(a, b);
    min += (haversine(a, b) / Math.max(1, speedKmh)) * 60;
    min += dwellMin; // estadía homogénea; luego podrías usar por-parada
  }
  // sumar dwell de última parada
  if (order.length) min += dwellMin;
  return { km, min };
}

/// ---------- Google Maps helpers ----------
function publishToGMaps(orderedRowObjs) {
  // publica para el botón "Ver en Google Maps" del index
  if (typeof window.setOptimizedPoints === "function") {
    const pts = orderedRowObjs.map((r) =>
      r.address ? { address: r.address } : { lat: r.lat, lng: r.lng }
    );
    window.setOptimizedPoints(pts);
  }
}

function renderDirLinks(orderedRowObjs) {
  if (!orderedRowObjs.length) {
    dirLinksEl.innerHTML = `<p class="text-slate-700">Sin tramos aún.</p>`;
    return;
  }
  const items = [];
  for (let i = 0; i < orderedRowObjs.length - 1; i++) {
    const A = orderedRowObjs[i];
    const B = orderedRowObjs[i + 1];
    const o = A.address ? A.address : `${A.lat},${A.lng}`;
    const d = B.address ? B.address : `${B.lat},${B.lng}`;
    const url =
      "https://www.google.com/maps/dir/?api=1&origin=" +
      encodeURIComponent(o) +
      "&destination=" +
      encodeURIComponent(d);
    items.push(
      `<a class="underline text-sky-800" target="_blank" href="${url}">Tramo ${i + 1}</a>`
    );
  }
  dirLinksEl.innerHTML = `<div class="flex flex-wrap gap-2">${items.join(
    ""
  )}</div>`;
}

/// ---------- Flujo principal ----------
async function updateFromText({ optimize = false } = {}) {
  try {
    setStatus("Procesando entradas…");
    // 1) Parse
    state.rawRows = parseInputText();

    // 2) Geocoder
    for (let i = 0; i < state.rawRows.length; i++) {
      const r = state.rawRows[i];
      if (r.lat != null && r.lng != null) continue;
      const g = await geocode(r.address);
      if (g) Object.assign(r, g);
      await sleep(50);
      setStatus(`Geocodificando (${i + 1}/${state.rawRows.length})…`);
    }

    renderTable();

    if (!optimize) {
      setStatus("Listo. Podés optimizar cuando quieras.");
      return;
    }

    // 3) Optimizar (Nearest-Neighbor rápido)
    const speed = Number(avgSpeedEl.value || 40) || 40;
    const dwellMin = Number(defaultDwellEl.value || 10) || 10;
    const pts = state.rawRows.map((r) => ({ lat: r.lat, lng: r.lng }));
    const order = nearestNeighbor(pts, 0, circularEl.checked);
    state.orderedIdx = order;

    const { km, min } = calcDistanceAndTime(order, pts, speed, dwellMin);
    state.totalKm = km;
    state.totalMin = min;

    // 4) Mostrar resultados + links + publicar a botón GMaps
    const orderedRows = order.map((idx) => state.rawRows[idx]);
    publishToGMaps(orderedRows);
    renderDirLinks(orderedRows);
    setResults({ stops: orderedRows.length, km, min });

    setStatus("Ruta optimizada.");
  } catch (e) {
    console.error(e);
    setStatus("Error: " + (e.message || e));
  }
}

/// ---------- Acciones UI ----------
$("#oneClick")?.addEventListener("click", () =>
  updateFromText({ optimize: true })
);
$("#updateBtn")?.addEventListener("click", () => updateFromText({ optimize: false }));
$("#clearBtn")?.addEventListener("click", () => {
  linksTA.value = "";
  state.rawRows = [];
  state.orderedIdx = [];
  renderTable();
  setStatus("Entradas limpiadas.");
  resultsEl.innerHTML = `<p class="text-slate-700">Aún sin resultados.</p>`;
  dirLinksEl.innerHTML = `<p>Se generan links a Google Maps por tramos.</p>`;
});

/// Copiar orden
$("#copyOrder")?.addEventListener("click", async () => {
  try {
    const orderedRows = state.orderedIdx.map((i) => state.rawRows[i]);
    const txt = orderedRows
      .map(
        (r, i) =>
          `${i + 1}. ${r.name ? r.name + " | " : ""}${r.address || ""}${
            r.lat && r.lng ? ` (${r.lat.toFixed(5)}, ${r.lng.toFixed(5)})` : ""
          }`
      )
      .join("\n");
    await navigator.clipboard.writeText(txt);
    setStatus("Orden copiado al portapapeles.");
  } catch (e) {
    setStatus("No se pudo copiar: " + (e.message || e));
  }
});

/// Export CSV
$("#exportCsv")?.addEventListener("click", () => {
  const orderedRows =
    state.orderedIdx.length > 0
      ? state.orderedIdx.map((i) => state.rawRows[i])
      : state.rawRows;
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
  const rows = orderedRows.map((r, idx) => [
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
    rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ruta.csv";
  a.click();
  URL.revokeObjectURL(url);
});

/// ---------- Guardado local + (opcional) Firestore ----------
const LS_KEY = "solgist:namedRoutes:v1";

function loadAllNamed() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveAllNamed(obj) {
  localStorage.setItem(LS_KEY, JSON.stringify(obj));
}
function refreshNamedSelect() {
  const all = loadAllNamed();
  const sel = $("#savedSelect");
  sel.innerHTML = Object.keys(all)
    .map((k) => `<option value="${k}">${k}</option>`)
    .join("");
}

async function saveNamed(name) {
  if (!name) return;
  const all = loadAllNamed();
  all[name] = {
    rows: state.rawRows,
    orderedIdx: state.orderedIdx,
    ts: Date.now(),
  };
  saveAllNamed(all);
  refreshNamedSelect();
  setStatus(`Ruta "${name}" guardada localmente.`);
  // Firestore opcional
  try {
    const fb = window._firebase;
    if (fb?.auth?.currentUser) {
      const { db, doc, setDoc } = fb;
      await setDoc(
        fb.doc(db, "routes", fb.auth.currentUser.uid + "::" + name),
        all[name]
      );
      setStatus(`Ruta "${name}" sincronizada en la nube.`);
    }
  } catch (e) {
    console.warn("Firestore save error:", e);
  }
}

async function loadNamed(name) {
  const all = loadAllNamed();
  const data = all[name];
  if (!data) return;
  state.rawRows = data.rows || [];
  state.orderedIdx = data.orderedIdx || [];
  renderTable();
  setStatus(`Ruta "${name}" cargada.`);
  const orderedRows =
    state.orderedIdx.length > 0
      ? state.orderedIdx.map((i) => state.rawRows[i])
      : state.rawRows;
  publishToGMaps(orderedRows);
  renderDirLinks(orderedRows);
  setResults({
    stops: orderedRows.length,
    km: state.totalKm || 0,
    min: state.totalMin || 0,
  });
}

// Botones de guardado
$("#saveNamed")?.addEventListener("click", () => {
  const name = $("#routeName")?.value?.trim();
  if (!name) return alert("Elegí un nombre de ruta");
  saveNamed(name);
});
$("#updateNamed")?.addEventListener("click", () => {
  const name = $("#savedSelect")?.value;
  if (!name) return alert("Elegí una ruta guardada");
  saveNamed(name);
});
$("#loadNamed")?.addEventListener("click", () => {
  const name = $("#savedSelect")?.value;
  if (!name) return alert("Elegí una ruta");
  loadNamed(name);
});
$("#renameNamed")?.addEventListener("click", () => {
  const sel = $("#savedSelect");
  const oldName = sel?.value;
  if (!oldName) return alert("Elegí una ruta");
  const newName = prompt("Nuevo nombre:", oldName);
  if (!newName || newName === oldName) return;
  const all = loadAllNamed();
  all[newName] = all[oldName];
  delete all[oldName];
  saveAllNamed(all);
  refreshNamedSelect();
  setStatus(`Renombrada a "${newName}".`);
});
$("#deleteNamed")?.addEventListener("click", () => {
  const name = $("#savedSelect")?.value;
  if (!name) return alert("Elegí una ruta");
  if (!confirm(`¿Borrar "${name}"?`)) return;
  const all = loadAllNamed();
  delete all[name];
  saveAllNamed(all);
  refreshNamedSelect();
  setStatus(`Ruta "${name}" borrada.`);
});
$("#exportNamed")?.addEventListener("click", () => {
  const name = $("#savedSelect")?.value;
  if (!name) return alert("Elegí una ruta");
  const all = loadAllNamed();
  const data = all[name];
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ruta-${name}.json`;
  a.click();
  URL.revokeObjectURL(url);
});
$("#importNamed")?.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const txt = await f.text();
  const data = JSON.parse(txt);
  const name = $("#routeName")?.value?.trim() || `import-${Date.now()}`;
  const all = loadAllNamed();
  all[name] = data;
  saveAllNamed(all);
  refreshNamedSelect();
  setStatus(`Importada como "${name}".`);
});

$("#syncNow")?.addEventListener("click", async () => {
  try {
    const fb = window._firebase;
    if (!fb?.auth?.currentUser) {
      setStatus("Debes iniciar sesión para sincronizar.");
      return;
    }
    const all = loadAllNamed();
    // sube todas
    await Promise.all(
      Object.entries(all).map(([name, data]) =>
        fb.setDoc(fb.doc(fb.db, "routes", fb.auth.currentUser.uid + "::" + name), data)
      )
    );
    setStatus("Sincronización completada.");
  } catch (e) {
    console.warn("Sync error:", e);
    setStatus("Error al sincronizar.");
  }
});

refreshNamedSelect();
setStatus("Listo para usar. Pegá direcciones y optimizá 🚀");
