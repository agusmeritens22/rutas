/* ==========================================================
   SOLGISTICA · app.js (tabla adaptativa + cronograma PDF)
   ========================================================== */

const $ = (sel) => document.querySelector(sel);
const fmt = (n, d = 1) =>
  new Intl.NumberFormat("es-AR", { maximumFractionDigits: d }).format(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hav = (deg) => (deg * Math.PI) / 180;
function haversine(a, b) {
  const R = 6371;
  const dLat = hav(b.lat - a.lat);
  const dLng = hav(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(hav(a.lat)) * Math.cos(hav(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
}
function timeStrToMin(t) {
  if (!t || !/^\d{2}:\d{2}$/.test(t)) return null;
  const [h,m]=t.split(':').map(Number); return h*60+m;
}
function minToTimeStr(m) {
  m = Math.max(0, Math.round(m));
  const h = Math.floor(m/60).toString().padStart(2,'0');
  const mm = (m%60).toString().padStart(2,'0'); return `${h}:${mm}`;
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
  rawRows: [],    // [{name,address,lat,lng,prec,dwell,open,close}]
  orderedIdx: [], // orden final
  totalKm: 0,
  totalMin: 0,
  schedule: []    // [{idx,name,address,arrive,depart,travelMin,waitMin}]
};

/* ---------- Geocoding ---------- */
async function geocode(address) {
  const key = window.GEOCODER?.key;
  if (!key) throw new Error("Falta window.GEOCODER.key");
  const url =
    "https://api.opencagedata.com/geocode/v1/json?no_annotations=1&language=es&limit=1&q=" +
    encodeURIComponent(address) + "&key=" + encodeURIComponent(key);
  const r = await fetch(url);
  if (!r.ok) throw new Error("Geocoder HTTP " + r.status);
  const j = await r.json();
  const it = j.results?.[0];
  if (!it) return null;
  const { lat, lng } = it.geometry;
  const prec = it.confidence ?? 0;
  return { lat: +lat, lng: +lng, prec };
}

/* ---------- Parser ---------- */
function parseInputText() {
  const lines = linksTA.value.split(/\r?\n/)
    .map(s=>s.trim()).filter(Boolean);
  return lines.map(line => {
    const [nameMaybe, addrMaybe] = line.split("|").map(s=>s?.trim());
    return {
      name: (nameMaybe && addrMaybe) ? nameMaybe : "",
      address: addrMaybe || line,
      dwell: Number(defaultDwellEl.value || 10) || 10,
      open:  defaultOpenEl.value || "",
      close: defaultCloseEl.value || ""
    };
  });
}

/* ---------- Tabla ---------- */
function renderTable() {
  const wrap = document.getElementById('inputTableWrap');
  const tbody = document.getElementById('inputTable');

  if (!state.rawRows.length) {
    if (wrap) {
      wrap.classList.add('hidden');
      wrap.style.removeProperty('display');
      wrap.style.removeProperty('visibility');
    }
    if (tbody) tbody.innerHTML = "";
    return;
  }

  if (wrap) {
    wrap.classList.remove('hidden');     // quita la clase hidden
    wrap.style.display = 'block';         // fuerza display por si algún estilo lo oculta
    wrap.style.visibility = 'visible';    // idem
  }

  if (!tbody) {
    console.warn('No se encontró #inputTable en el DOM');
    return;
  }

  tbody.innerHTML = state.rawRows.map((r, i) => {
    const nameVal = (r.name || "").replaceAll('"', "&quot;");
    const addrVal = (r.address || "").replaceAll('"', "&quot;");
    const latVal  = r.lat?.toFixed?.(6) ?? "";
    const lngVal  = r.lng?.toFixed?.(6) ?? "";
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
  <td class="py-3 px-4 ${precTxt==='Exacta' ? 'text-emerald-700' : 'text-amber-600'}">${precTxt}</td>
  <td class="py-3 px-4">
    <input data-k="dwell" data-i="${i}" type="number" min="0" step="1" value="${r.dwell ?? 10}"
      class="w-24 px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>
  <td class="py-3 px-4">
    <input data-k="open" data-i="${i}" type="time" value="${r.open || ''}"
      class="px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>
  <td class="py-3 px-4">
    <input data-k="close" data-i="${i}" type="time" value="${r.close || ''}"
      class="px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>
</tr>`;
  }).join("");

  // bind cambios
  tbody.querySelectorAll("input[data-k]").forEach((el) => {
    el.addEventListener("change", () => {
      const i = Number(el.dataset.i);
      const k = el.dataset.k;
      let v = el.value;
      if (k === "dwell") v = Number(v) || 0;
      state.rawRows[i][k] = v;
    });
  });
}


/* ---------- Mensajes / resultados ---------- */
function setStatus(msg){ statusEl.textContent = msg; }
function setResults({stops,km,min}){
  resultsEl.innerHTML = `
    <div>Paradas: <strong>${stops}</strong></div>
    <div>Distancia estimada: <strong>${fmt(km,1)} km</strong></div>
    <div>Duración total: <strong>${fmt(min,0)} min</strong></div>`;
}

/* ---------- Optimización NN ---------- */
function nearestNeighbor(points, startIdx=0, circular=false){
  const n=points.length; if(n<=1) return [...Array(n).keys()];
  const used=Array(n).fill(false), order=[]; let cur=startIdx;
  order.push(cur); used[cur]=true;
  for(let step=1; step<n; step++){
    let best=-1, bestD=1e9;
    for(let j=0;j<n;j++){
      if(used[j]) continue;
      const d=haversine(points[cur], points[j]);
      if(d<bestD){ bestD=d; best=j; }
    }
    cur=best; used[cur]=true; order.push(cur);
  }
  if(circular) order.push(order[0]);
  return order;
}
function calcDistanceAndTime(order, pts, speedKmh, dwellMin){
  let km=0, min=0;
  for(let i=0;i<order.length-1;i++){
    const a=pts[order[i]], b=pts[order[i+1]];
    const d=haversine(a,b);
    km+=d; min+=(d/Math.max(1,speedKmh))*60; min+=dwellMin;
  }
  if(order.length) min+=dwellMin;
  return {km,min};
}

/* ---------- Cronograma ---------- */
function buildSchedule(orderedRows){
  const speed = Number(avgSpeedEl.value||40)||40;
  const defaultDwell = Number(defaultDwellEl.value||10)||10;
  let nowMin = timeStrToMin(startTimeEl.value) ?? 8*60;

  const sched = [];
  for(let i=0;i<orderedRows.length;i++){
    let travelMin = 0;
    if(i>0){
      const prev = orderedRows[i-1], cur = orderedRows[i];
      travelMin = (haversine(prev, cur) / Math.max(1,speed)) * 60;
    }
    let arrive = nowMin + travelMin;

    // Ventanas horarias simples
    const openMin  = timeStrToMin(orderedRows[i].open);
    const closeMin = timeStrToMin(orderedRows[i].close);
    let waitMin = 0;
    if(openMin!=null && arrive < openMin){ waitMin = openMin - arrive; arrive = openMin; }
    let dwell = Number(orderedRows[i].dwell ?? defaultDwell) || defaultDwell;
    let depart = arrive + dwell;
    if(closeMin!=null && depart > closeMin && enforceWindowsEl.checked){
      // si no cabe dentro de ventana, igual dejamos marcado
      depart = closeMin;
    }

    sched.push({
      idx:i+1,
      name: orderedRows[i].name || '',
      address: orderedRows[i].address || `${orderedRows[i].lat},${orderedRows[i].lng}`,
      travelMin: Math.round(travelMin),
      arrive: Math.round(arrive),
      waitMin: Math.round(waitMin),
      depart: Math.round(depart)
    });

    nowMin = depart;
  }
  return sched;
}

function openSchedulePrint(schedule, totals){
  const win = window.open("", "_blank", "noopener,noreferrer");
  const rows = schedule.map(s=>`
    <tr>
      <td>${s.idx}</td>
      <td>${s.name ? s.name : "-"}</td>
      <td>${s.address}</td>
      <td style="white-space:nowrap">${minToTimeStr(s.arrive)}</td>
      <td style="white-space:nowrap">${minToTimeStr(s.depart)}</td>
      <td>${s.travelMin} min</td>
      <td>${s.waitMin} min</td>
    </tr>`).join("");

  win.document.write(`
<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Cronograma</title>
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

/* ---------- Google Maps links (se mantienen) ---------- */
function publishToGMaps(orderedRows) {
  const pts = (orderedRows||[]).map(r => r.address ? {address:r.address}:{lat:r.lat,lng:r.lng});
  if (typeof window.setOptimizedPoints === "function") window.setOptimizedPoints(pts);
  else window._optimizedPoints = pts;
}
function renderDirLinks(orderedRows){
  if(!orderedRows.length){ dirLinksEl.innerHTML = `<p class="text-slate-700">Sin tramos aún.</p>`; return; }
  const items=[];
  for(let i=0;i<orderedRows.length-1;i++){
    const A=orderedRows[i], B=orderedRows[i+1];
    const o=A.address || `${A.lat},${A.lng}`;
    const d=B.address || `${B.lat},${B.lng}`;
    const url="https://www.google.com/maps/dir/?api=1&origin="+encodeURIComponent(o)+"&destination="+encodeURIComponent(d);
    items.push(`<a class="underline text-sky-800" target="_blank" href="${url}">Tramo ${i+1}</a>`);
  }
  dirLinksEl.innerHTML = `<div class="flex flex-wrap gap-2">${items.join("")}</div>`;
}

/* ---------- Flujo principal ---------- */
async function updateFromText({ optimize=false } = {}){
  try{
    setStatus("Procesando entradas…");
    state.rawRows = parseInputText();

    for(let i=0;i<state.rawRows.length;i++){
      const r=state.rawRows[i];
      if(r.lat!=null && r.lng!=null) continue;
      const g=await geocode(r.address);
      if(g) Object.assign(r,g);
      setStatus(`Geocodificando (${i+1}/${state.rawRows.length})…`);
      await sleep(40);
    }

    renderTable();

    // Publicar y links aunque no optimices
    publishToGMaps(state.rawRows);
    renderDirLinks(state.rawRows);

    if(!optimize){
      setResults({stops: state.rawRows.length, km: 0, min: 0});
      setStatus("Listo. Podés optimizar cuando quieras.");
      state.schedule = buildSchedule(state.rawRows);
      return;
    }

    const speed = Number(avgSpeedEl.value||40)||40;
    const dwellMin = Number(defaultDwellEl.value||10)||10;
    const pts = state.rawRows.map(r=>({lat:r.lat,lng:r.lng}));
    const order = nearestNeighbor(pts, 0, circularEl.checked);
    state.orderedIdx = order;

    const {km,min} = calcDistanceAndTime(order, pts, speed, dwellMin);
    state.totalKm = km; state.totalMin = min;

    const orderedRows = order.map(i=>state.rawRows[i]);
    publishToGMaps(orderedRows);
    renderDirLinks(orderedRows);
    setResults({stops: orderedRows.length, km, min});

    state.schedule = buildSchedule(orderedRows);
    setStatus("Ruta optimizada.");
  }catch(e){
    console.error(e); setStatus("Error: "+(e.message||e));
  }
}

/* ---------- Acciones UI ---------- */
$("#oneClick")?.addEventListener("click", ()=>updateFromText({optimize:true}));
$("#updateBtn")?.addEventListener("click", ()=>updateFromText({optimize:false}));
$("#clearBtn")?.addEventListener("click", ()=>{
  linksTA.value=""; state.rawRows=[]; state.orderedIdx=[]; state.schedule=[];
  renderTable(); setStatus("Entradas limpiadas.");
  resultsEl.innerHTML=`<p class="text-slate-700">Aún sin resultados.</p>`;
  dirLinksEl.innerHTML=`<p>Se generan links a Google Maps por tramos.</p>`;
});

/* Copiar / CSV (igual) */
$("#copyOrder")?.addEventListener("click", async ()=>{
  try{
    const orderedRows = state.orderedIdx.length ? state.orderedIdx.map(i=>state.rawRows[i]) : state.rawRows;
    const txt = orderedRows.map((r,i)=>`${i+1}. ${r.name? r.name+' | ':''}${r.address||''}`).join("\n");
    await navigator.clipboard.writeText(txt);
    setStatus("Orden copiado al portapapeles.");
  }catch(e){ setStatus("No se pudo copiar: "+(e.message||e)); }
});
$("#exportCsv")?.addEventListener("click", ()=>{
  const orderedRows = state.orderedIdx.length ? state.orderedIdx.map(i=>state.rawRows[i]) : state.rawRows;
  const head=["orden","local","direccion","lat","lng","precision","dwell","abre","cierra"];
  const rows=orderedRows.map((r,idx)=>[idx+1,r.name||"",r.address||"",r.lat??"",r.lng??"",r.prec??"",r.dwell??"",r.open||"",r.close||""]);
  const csv = head.join(",")+"\n"+rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}); const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download="ruta.csv"; a.click(); URL.revokeObjectURL(url);
});

/* Descargar PDF del cronograma */
$("#downloadPdf")?.addEventListener("click", ()=>{
  const rows = state.orderedIdx.length ? state.orderedIdx.map(i=>state.rawRows[i]) : state.rawRows;
  if(!rows.length){ alert("Primero cargá y/o optimizá las direcciones."); return; }
  const schedule = state.schedule?.length ? state.schedule : buildSchedule(rows);
  const totals = { km: state.totalKm||0, min: state.totalMin||0 };
  openSchedulePrint(schedule, totals);
});

/* ---------- Guardado local + sync (sin cambios relevantes) ---------- */
const LS_KEY="solgist:namedRoutes:v1";
const loadAllNamed=()=>{ try{return JSON.parse(localStorage.getItem(LS_KEY)||"{}");}catch{return{}} };
const saveAllNamed=(o)=>localStorage.setItem(LS_KEY, JSON.stringify(o));
function refreshNamedSelect(){
  const all=loadAllNamed(); const sel=$("#savedSelect"); if(!sel) return;
  sel.innerHTML=Object.keys(all).map(k=>`<option value="${k}">${k}</option>`).join("");
}
async function saveNamed(name){
  if(!name) return;
  const all=loadAllNamed();
  all[name]={ rows:state.rawRows, orderedIdx:state.orderedIdx, ts:Date.now() };
  saveAllNamed(all); refreshNamedSelect(); setStatus(`Ruta "${name}" guardada localmente.`);
  try{
    const fb=window._firebase; if(fb?.auth?.currentUser){
      await fb.setDoc(fb.doc(fb.db,"routes",fb.auth.currentUser.uid+"::"+name), all[name]);
      setStatus(`Ruta "${name}" sincronizada en la nube.`);
    }
  }catch(e){ console.warn("Firestore save error:",e); }
}
async function loadNamed(name){
  const all=loadAllNamed(); const data=all[name]; if(!data) return;
  state.rawRows=data.rows||[]; state.orderedIdx=data.orderedIdx||[]; renderTable();
  const orderedRows = state.orderedIdx.length ? state.orderedIdx.map(i=>state.rawRows[i]) : state.rawRows;
  publishToGMaps(orderedRows); renderDirLinks(orderedRows);
  state.schedule = buildSchedule(orderedRows);
  setResults({stops: orderedRows.length, km: state.totalKm||0, min: state.totalMin||0});
  setStatus(`Ruta "${name}" cargada.`);
}
$("#saveNamed")?.addEventListener("click", ()=>{ const n=$("#routeName")?.value?.trim(); if(!n) return alert("Elegí un nombre"); saveNamed(n); });
$("#updateNamed")?.addEventListener("click", ()=>{ const n=$("#savedSelect")?.value; if(!n) return alert("Elegí una ruta guardada"); saveNamed(n); });
$("#loadNamed")?.addEventListener("click", ()=>{ const n=$("#savedSelect")?.value; if(!n) return alert("Elegí una ruta"); loadNamed(n); });
$("#renameNamed")?.addEventListener("click", ()=>{
  const sel=$("#savedSelect"); const old=sel?.value; if(!old) return alert("Elegí una ruta");
  const nn=prompt("Nuevo nombre:", old); if(!nn || nn===old) return;
  const all=loadAllNamed(); all[nn]=all[old]; delete all[old]; saveAllNamed(all); refreshNamedSelect(); setStatus(`Renombrada a "${nn}".`);
});
$("#deleteNamed")?.addEventListener("click", ()=>{
  const n=$("#savedSelect")?.value; if(!n) return alert("Elegí una ruta");
  if(!confirm(`¿Borrar "${n}"?`)) return; const all=loadAllNamed(); delete all[n]; saveAllNamed(all); refreshNamedSelect(); setStatus(`Ruta "${n}" borrada.`);
});
$("#exportNamed")?.addEventListener("click", ()=>{
  const n=$("#savedSelect")?.value; if(!n) return alert("Elegí una ruta");
  const all=loadAllNamed(); const data=all[n];
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url; a.download=`ruta-${n}.json`; a.click(); URL.revokeObjectURL(url);
});
$("#importNamed")?.addEventListener("change", async (e)=>{
  const f=e.target.files?.[0]; if(!f) return;
  const data=JSON.parse(await f.text());
  const n=$("#routeName")?.value?.trim() || `import-${Date.now()}`;
  const all=loadAllNamed(); all[n]=data; saveAllNamed(all); refreshNamedSelect(); setStatus(`Importada como "${n}".`);
});
$("#syncNow")?.addEventListener("click", async ()=>{
  try{
    const fb=window._firebase; if(!fb?.auth?.currentUser){ setStatus("Debes iniciar sesión para sincronizar."); return; }
    const all=loadAllNamed();
    await Promise.all(Object.entries(all).map(([n,d])=>fb.setDoc(fb.doc(fb.db,"routes",fb.auth.currentUser.uid+"::"+n), d)));
    setStatus("Sincronización completada.");
  }catch(e){ console.warn("Sync error:",e); setStatus("Error al sincronizar."); }
});

refreshNamedSelect();
setStatus("Listo para usar. Pegá direcciones y optimizá 🚀");
