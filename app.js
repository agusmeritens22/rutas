/* ==========================================================
   SOLGISTICA · app.js (Firestore Sync)
   - Todo lo del build anterior (estado, enlaces, circular, rutas locales)
   - + Sincronización en la nube con Firebase Firestore por usuario (uid)
   - Usa colección: users/{uid}/routes/{docId}  (docId = nombre saneado)
   - Auto-pull al loguearte y botón "Sincronizar ahora" para forzar merge
   ========================================================== */

(function(){
  /* ---------- Utils ---------- */
  const $ = (s)=>document.querySelector(s);
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const fmt = (n, d=1)=> new Intl.NumberFormat("es-AR",{maximumFractionDigits:d}).format(n);
  const toRad = (deg)=> (deg*Math.PI)/180;
  function haversine(a,b){
    const R = 6371;
    const dLat = toRad((b.lat||0)-(a.lat||0));
    const dLng = toRad((b.lng||0)-(a.lng||0));
    const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat||0))*Math.cos(toRad(b.lat||0))*Math.sin(Math.min(1,dLng/2))**2;
    return 2*R*Math.asin(Math.sqrt(s));
  }
  function timeStrToMin(t){ if(!t || !/^\d{2}:\d{2}$/.test(t)) return null; const [h,m]=t.split(":").map(Number); return h*60+m; }
  function minToTimeStr(m){ m=Math.max(0,Math.round(m||0)); const h=String(Math.floor(m/60)).padStart(2,"0"); const mm=String(m%60).padStart(2,"0"); return `${h}:${mm}`; }
  function nowIso(){ return new Date().toISOString(); }
  function sanitizeId(name){ return String(name||"").trim().replace(/[/#?[\]\.]/g,"_").slice(0,150); }

  /* ---------- DOM refs ---------- */
  const linksTA = $("#links");
  const inputTableWrap = $("#inputTableWrap");
  const inputTable = $("#inputTable");
  const resultsEl = $("#results");
  const dirLinksEl = $("#dirLinks");
  const statusEl = $("#status");
  const autoRunEl = $("#autoRun");
  const circularEl = $("#circular");

  const avgSpeedEl = $("#avgSpeed");
  const defaultDwellEl = $("#defaultDwell");
  const startTimeEl = $("#startTime");
  const defaultOpenEl = $("#defaultOpen");
  const defaultCloseEl = $("#defaultClose");
  const enforceWindowsEl = $("#enforceWindows");

  /* ---------- Panel "Rutas guardadas" (tus IDs) ---------- */
  const routeNameInp = $("#routeName");
  const saveNamedBtn = $("#saveNamed");
  const updateNamedBtn = $("#updateNamed");
  const syncNowBtn    = $("#syncNow");
  const savedSelect   = $("#savedSelect");
  const loadNamedBtn  = $("#loadNamed");
  const renameNamedBtn= $("#renameNamed");
  const deleteNamedBtn= $("#deleteNamed");
  const exportNamedBtn= $("#exportNamed");
  const importNamedInp= $("#importNamed");

  /* ---------- Estado ---------- */
  const state = { rawRows:[], schedule:[], totalKm:0, totalMin:0 };

  /* ---------- Estado helpers ---------- */
  function setStatus(msg){ if (statusEl) statusEl.textContent = msg; }

  /* ==========================================================
     Geocoder (OpenCage)
     ========================================================== */
  async function geocode(address){
    const key = window.GEOCODER?.key;
    if(!key) return null;
    const url = "https://api.opencagedata.com/geocode/v1/json?no_annotations=1&language=es&limit=1&q=" + encodeURIComponent(address) + "&key=" + encodeURIComponent(key);
    const r = await fetch(url);
    const j = await r.json();
    const it = j.results?.[0];
    if(!it) return null;
    const {lat,lng} = it.geometry;
    const prec = it.confidence ?? 0;
    return {lat: Number(lat), lng: Number(lng), prec};
  }

  /* ==========================================================
     Parseo de textarea
     ========================================================== */
  function parseInputText(){
    const lines = (linksTA?.value || "").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    return lines.map(line=>{
      const [nameMaybe, addrMaybe] = line.split("|").map(s=>s?.trim());
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
     Tabla editable
     ========================================================== */
  function renderTable(){
    if(!inputTableWrap || !inputTable) return;
    if(!state.rawRows.length){
      inputTableWrap.classList.add("hidden");
      inputTable.innerHTML = "";
      return;
    }
    inputTableWrap.classList.remove("hidden");

    inputTable.innerHTML = state.rawRows.map((r,i)=>{
      const nameVal=(r.name||"").replaceAll('"',"&quot;");
      const addrVal=(r.address||"").replaceAll('"',"&quot;");
      const latVal = r.lat?.toFixed?.(6) ?? "";
      const lngVal = r.lng?.toFixed?.(6) ?? "";
      const precTxt = r.prec ? (r.prec >= 8 ? "Exacta" : "Aprox.") : "";
      return `
<tr class="bg-white">
  <td class="py-3 px-4">${i+1}</td>
  <td class="py-3 px-4">
    <input data-k="name" data-i="${i}" value="${nameVal}" class="w-full px-4 py-3 text-[15px] font-medium rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>
  <td class="py-3 px-4 w-full">
    <input data-k="address" data-i="${i}" value="${addrVal}" class="w-full px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>
  <td class="py-3 px-4 mono">${latVal}</td>
  <td class="py-3 px-4 mono">${lngVal}</td>
  <td class="py-3 px-4 ${precTxt==="Exacta"?"text-emerald-700":"text-amber-600"}">${precTxt}</td>
  <td class="py-3 px-4">
    <input data-k="dwell" data-i="${i}" type="number" min="0" step="1" value="${r.dwell??10}" class="w-24 px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>
  <td class="py-3 px-4">
    <input data-k="open" data-i="${i}" type="time" value="${r.open||""}" class="px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>
  <td class="py-3 px-4">
    <input data-k="close" data-i="${i}" type="time" value="${r.close||""}" class="px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>
</tr>`;
    }).join("");

    inputTable.querySelectorAll("input[data-k]").forEach((el)=>{
      el.addEventListener("change", ()=>{
        const i = Number(el.dataset.i);
        const k = el.dataset.k;
        let v = el.value;
        if(k==="dwell") v = Number(v)||0;
        state.rawRows[i][k]=v;
      });
    });
  }

  /* ==========================================================
     Cronograma
     ========================================================== */
  function buildSchedule(rowsInOrder){
    const speed = Number(avgSpeedEl?.value || 40) || 40;
    const defaultDwell = Number(defaultDwellEl?.value || 10) || 10;
    let nowMin = timeStrToMin(startTimeEl?.value) ?? 8*60;

    return rowsInOrder.map((row,i)=>{
      let travelMin = 0;
      if(i>0){
        const prev = rowsInOrder[i-1];
        travelMin = (haversine(prev,row) / Math.max(1,speed))*60;
      }
      let arrive = nowMin + travelMin;

      const openMin = timeStrToMin(row.open);
      const closeMin = timeStrToMin(row.close);
      let waitMin = 0;
      if(openMin!=null && arrive<openMin){ waitMin = openMin - arrive; arrive = openMin; }

      let dwell = Number(row.dwell ?? defaultDwell) || defaultDwell;
      let depart = arrive + dwell;
      if(closeMin!=null && depart>closeMin && enforceWindowsEl?.checked){ depart = closeMin; }

      nowMin = depart;
      return {
        idx:i+1, name:row.name||"", address:row.address,
        travelMin:Math.round(travelMin), arrive:Math.round(arrive), waitMin:Math.round(waitMin), depart:Math.round(depart),
        lat:row.lat, lng:row.lng
      };
    });
  }
  function renderScheduleTable(schedule){
    if(!schedule?.length) return "";
    const rows = schedule.map(s=>`
      <tr>
        <td class="py-2 px-2">${s.idx}</td>
        <td class="py-2 px-2">${s.name||"-"}</td>
        <td class="py-2 px-2">${s.address}</td>
        <td class="py-2 px-2 whitespace-nowrap">${minToTimeStr(s.arrive)}</td>
        <td class="py-2 px-2 whitespace-nowrap">${minToTimeStr(s.depart)}</td>
        <td class="py-2 px-2">${s.travelMin} min</td>
        <td class="py-2 px-2">${s.waitMin} min</td>
      </tr>`).join("");
    return `
      <div class="rounded-lg border border-slate-200 overflow-hidden bg-white">
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
  function renderResultsSummary({stops,km,min}){
    if(!resultsEl) return;
    const head = `
      <div class="flex flex-wrap gap-4">
        <div>Paradas: <strong>${stops}</strong></div>
        <div>Distancia estimada: <strong>${fmt(km,1)} km</strong></div>
        <div>Duración total: <strong>${fmt(min,0)} min</strong></div>
      </div>`;
    const sched = renderScheduleTable(state.schedule||[]);
    resultsEl.innerHTML = head + (sched ? `<div class="mt-3">${sched}</div>` : "");
  }

  /* ==========================================================
     Enlaces de navegación + Ruta circular
     ========================================================== */
  function pointToStr(p){
    if(!p) return "";
    if(typeof p.address==="string" && p.address.trim().length>0) return p.address.trim();
    if(typeof p.lat==="number" && typeof p.lng==="number") return `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
    return "";
  }
  function makeMapsUrl(points){
    const parts = (points||[]).map(pointToStr).filter(Boolean).map(encodeURIComponent);
    if(parts.length===1) parts.push(parts[0]);
    return `https://www.google.com/maps/dir/${parts.join('/')}`;
  }
  function perLegLinks(points){
    const out=[]; const arr = Array.isArray(points)?points:[];
    for(let i=0;i<arr.length-1;i++){
      const a=arr[i], b=arr[i+1];
      const A=pointToStr(a), B=pointToStr(b);
      if(!A || !B) continue;
      if(A===B) continue;
      out.push({ i:i+1, from:A, to:B, url: makeMapsUrl([a,b]) });
    }
    return out;
  }
  function chunkedFullRouteLinks(points){
    const clean = (points||[]).map(pointToStr).filter(Boolean);
    if(clean.length<2) return [];
    const maxPerUrl = 10;
    const res=[]; let start=0, idx=1;
    while(start < clean.length-1){
      const end = Math.min(start + maxPerUrl - 1, clean.length - 1);
      const slice = clean.slice(start, end+1);
      if(slice.length>=2){
        const url = "https://www.google.com/maps/dir/" + slice.map(encodeURIComponent).join('/');
        res.push({ idx, range:[start+1,end+1], url });
        idx++;
      }
      start = end;
    }
    return res;
  }
  function maybeCloseLoop(points){
    const arr = Array.isArray(points) ? points.slice() : [];
    if(circularEl?.checked && arr.length>1) arr.push(arr[0]);
    return arr;
  }
  function updateNavLinksAndAPI(points){
    const published = maybeCloseLoop(points||[]);
    if(typeof window.setOptimizedPoints === "function"){ window.setOptimizedPoints(published); }
    else { window._optimizedPoints = published; }
    if(!dirLinksEl) return;
    const legs = perLegLinks(published);
    const fullChunks = chunkedFullRouteLinks(published);
    if((!legs||!legs.length) && (!fullChunks||!fullChunks.length)){
      dirLinksEl.innerHTML = `<p>No hay suficientes puntos válidos para generar enlaces.</p>`;
      return;
    }
    dirLinksEl.innerHTML = `
      <div class="space-y-2">
        ${fullChunks.length ? `
        <div class="text-sm font-semibold">Ruta completa</div>
        <div class="flex flex-col gap-1">
          ${fullChunks.map(c=>`
            <a class="underline text-sky-700" target="_blank" rel="noopener" href="${c.url}">
              Ruta ${c.idx} (${c.range[0]}–${c.range[1]})
            </a>`).join('')}
        </div>` : ``}
        <div class="mt-2 text-xs text-slate-500">Abrir por tramos:</div>
        <div class="flex flex-col gap-1">
          ${legs.map(l=>`
            <a class="text-sm underline text-sky-700" target="_blank" rel="noopener" href="${l.url}">
              Tramo ${l.i}: ${l.from} → ${l.to}
            </a>`).join('')}
        </div>
      </div>`;
  }

  /* ==========================================================
     Storage local + Firestore
     ========================================================== */
  function safeStorage(){
    try{ const k="__test_ls__"; localStorage.setItem(k,"1"); localStorage.removeItem(k); return localStorage; }catch{ return null; }
  }
  const LS = safeStorage();
  const ROUTES_KEY = "solgistica.routes.v1";
  function readAllRoutes(){ if(!LS) return {}; try{ return JSON.parse(LS.getItem(ROUTES_KEY)||"{}"); }catch{ return {}; } }
  function writeAllRoutes(obj){ if(!LS) throw new Error("localStorage no disponible"); LS.setItem(ROUTES_KEY, JSON.stringify(obj)); }
  function lastUpdatedOf(r){ return r?.updatedAt || r?.createdAt || ""; }

  // Firebase helpers (compatibles v8 y v9 modular)
  function fb(){
    const fb = window.firebase || {};
    // v9 modular support if available
    const app = fb.app?.() || fb.app || null;
    const auth = fb.auth?.() || (fb.auth && typeof fb.auth === "function" ? fb.auth() : null);
    const fs   = fb.firestore?.() || (fb.firestore && typeof fb.firestore === "function" ? fb.firestore() : null);
    return { app, auth, fs };
  }

  async function cloudSaveRoute(uid, name, payload){
    const { fs } = fb(); if(!fs) throw new Error("Firestore no disponible.");
    const id = sanitizeId(name);
    await fs.collection("users").doc(uid).collection("routes").doc(id).set(payload, { merge:true });
  }
  async function cloudLoadRoute(uid, name){
    const { fs } = fb(); if(!fs) throw new Error("Firestore no disponible.");
    const id = sanitizeId(name);
    const snap = await fs.collection("users").doc(uid).collection("routes").doc(id).get();
    return snap.exists ? snap.data() : null;
  }
  async function cloudDeleteRoute(uid, name){
    const { fs } = fb(); if(!fs) throw new Error("Firestore no disponible.");
    const id = sanitizeId(name);
    await fs.collection("users").doc(uid).collection("routes").doc(id).delete();
  }
  async function cloudListRoutes(uid){
    const { fs } = fb(); if(!fs) throw new Error("Firestore no disponible.");
    const qs = await fs.collection("users").doc(uid).collection("routes").orderBy("name").get();
    return qs.docs.map(d=> d.data());
  }

  async function cloudPullMergeToLocal(uid){
    const cloud = await cloudListRoutes(uid);
    const local = readAllRoutes();
    let changed = false;
    cloud.forEach(item=>{
      const name = item?.name;
      if(!name) return;
      const loc = local[name];
      if(!loc || lastUpdatedOf(item) > lastUpdatedOf(loc)){
        local[name] = item;
        changed = true;
      }
    });
    if(changed) writeAllRoutes(local);
    return changed;
  }
  async function cloudPushLocal(uid){
    const local = readAllRoutes();
    const keys = Object.keys(local);
    for(const name of keys){
      const it = local[name];
      if(!it) continue;
      await cloudSaveRoute(uid, name, it);
    }
  }

  /* ==========================================================
     Guardar / Cargar / Borrar / Exportar / Renombrar / Importar
     ========================================================== */
  function saveCurrentRoute(name){
    if(!name || !name.trim()) throw new Error("Poné un nombre para la ruta.");
    if(!state?.rawRows?.length) throw new Error("No hay datos para guardar. Cargá direcciones y generá el cronograma.");
    const payload = {
      name: name.trim(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      rows: state.rawRows,
      schedule: state.schedule,
      totals: { km: state.totalKm, min: state.totalMin }
    };
    const all = readAllRoutes();
    all[payload.name] = payload;
    writeAllRoutes(all);
    // También subir a la nube si hay sesión
    const uid = window.currentUserUid;
    if(uid) cloudSaveRoute(uid, payload.name, payload).catch(console.warn);
    return payload.name;
  }
  function listRoutes(){
    const all = readAllRoutes();
    return Object.values(all).sort((a,b)=> (a.name||"").localeCompare(b.name||""));
  }
  function loadRouteByName(name){
    if(!name) throw new Error("Elegí una ruta de la lista.");
    const all = readAllRoutes();
    const it = all[name];
    if(!it) throw new Error("No encontré esa ruta.");
    state.rawRows = Array.isArray(it.rows) ? it.rows : [];
    renderTable();
    state.schedule = buildSchedule(state.rawRows);
    state.totalKm = 0;
    for (let i=0;i<state.rawRows.length-1;i++) state.totalKm += haversine(state.rawRows[i], state.rawRows[i+1]);
    state.totalMin = state.schedule.length ? (state.schedule[state.schedule.length-1].depart || 0) : 0;
    renderResultsSummary({ stops: state.rawRows.length, km: state.totalKm, min: state.totalMin });
    const points = state.rawRows.map(r =>
      (typeof r.address==="string" && r.address.trim())
        ? { address:r.address.trim() }
        : (typeof r.lat==="number" && typeof r.lng==="number" ? {lat:r.lat, lng:r.lng} : null)
    ).filter(Boolean);
    updateNavLinksAndAPI(points);
  }
  function deleteRouteByName(name){
    if(!name) throw new Error("Elegí una ruta para borrar.");
    const all = readAllRoutes();
    if(!all[name]) throw new Error("Esa ruta no existe.");
    delete all[name];
    writeAllRoutes(all);
    const uid = window.currentUserUid;
    if(uid) cloudDeleteRoute(uid, name).catch(console.warn);
  }
  function exportRouteJSON(name){
    const all = readAllRoutes();
    const it = all[name];
    if(!it) throw new Error("Elegí una ruta válida.");
    const blob = new Blob([JSON.stringify(it, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href=url; a.download=`${name}.json`; a.click(); URL.revokeObjectURL(url);
  }
  function renameRoute(oldName, newName){
    if(!newName || !newName.trim()) throw new Error("Poné un nombre nuevo.");
    const all = readAllRoutes();
    if(!all[oldName]) throw new Error("La ruta original no existe.");
    const payload = all[oldName];
    payload.name = newName.trim();
    payload.updatedAt = nowIso();
    delete all[oldName];
    all[payload.name] = payload;
    writeAllRoutes(all);
    const uid = window.currentUserUid;
    if(uid){
      cloudDeleteRoute(uid, oldName).catch(console.warn);
      cloudSaveRoute(uid, payload.name, payload).catch(console.warn);
    }
    return payload.name;
  }
  async function importRouteJSONFile(file){
    const text = await file.text();
    const data = JSON.parse(text);
    const all = readAllRoutes();
    let changed = false;
    if (data && data.name && data.rows) {
      all[data.name] = data; changed = true;
    } else if (data && typeof data === "object") {
      Object.keys(data).forEach(k=>{
        const it = data[k];
        if (it && it.name && it.rows) { all[it.name] = it; changed = true; }
      });
    } else {
      throw new Error("Formato de JSON no reconocido.");
    }
    if (changed){
      writeAllRoutes(all);
      const uid = window.currentUserUid;
      if(uid) await cloudPushLocal(uid).catch(console.warn);
    }
  }
  function updateExistingRoute(name){
    if(!name) throw new Error("Elegí una ruta para actualizar.");
    if(!state?.rawRows?.length) throw new Error("No hay datos actuales para guardar.");
    const all = readAllRoutes();
    if(!all[name]) throw new Error("Esa ruta no existe.");
    all[name] = {
      ...all[name],
      rows: state.rawRows,
      schedule: state.schedule,
      totals: { km: state.totalKm, min: state.totalMin },
      updatedAt: nowIso(),
    };
    writeAllRoutes(all);
    const uid = window.currentUserUid;
    if(uid) cloudSaveRoute(uid, name, all[name]).catch(console.warn);
  }

  /* ========= UI para el panel ========= */
  function refreshSavedSelect(){
    if(!savedSelect) return;
    const items = listRoutes();
    const current = savedSelect.value;
    savedSelect.innerHTML = `<option value="">— Rutas guardadas —</option>` +
      items.map(it => `<option value="${it.name}">${it.name}</option>`).join("");
    if (current && items.find(x=>x.name===current)) savedSelect.value = current;
  }

  saveNamedBtn?.addEventListener("click", ()=>{
    try{
      const name = routeNameInp?.value || "";
      const saved = saveCurrentRoute(name);
      refreshSavedSelect();
      if (savedSelect) savedSelect.value = saved;
      alert("Ruta guardada ✅ (local" + (window.currentUserUid? " + nube":"") + ")");
    }catch(e){ alert(e.message || "No se pudo guardar."); }
  });

  updateNamedBtn?.addEventListener("click", ()=>{
    try{ const name = savedSelect?.value || ""; updateExistingRoute(name); alert("Ruta actualizada ✅"); }
    catch(e){ alert(e.message || "No se pudo actualizar."); }
  });

  syncNowBtn?.addEventListener("click", async ()=>{
    try{
      if(!window.currentUserUid) return alert("Iniciá sesión para sincronizar con la nube.");
      setStatus("Sincronizando…");
      await cloudPushLocal(window.currentUserUid);
      const changed = await cloudPullMergeToLocal(window.currentUserUid);
      refreshSavedSelect();
      setStatus("Listo ✅");
      alert(changed ? "Sincronizado (con cambios) ☁️" : "Sincronizado (sin cambios) ☁️");
    }catch(e){ setStatus("Error al sincronizar"); alert(e.message || "No se pudo sincronizar."); }
  });

  loadNamedBtn?.addEventListener("click", ()=>{
    try{
      const name = savedSelect?.value || "";
      loadRouteByName(name);
      if (routeNameInp && name) routeNameInp.value = name;
      alert("Ruta cargada ✅");
    }catch(e){ alert(e.message || "No se pudo cargar."); }
  });

  renameNamedBtn?.addEventListener("click", ()=>{
    try{
      const oldName = savedSelect?.value || "";
      if(!oldName) return alert("Elegí una ruta para renombrar.");
      const newName = prompt(`Nuevo nombre para "${oldName}":`, oldName);
      if(!newName || !newName.trim()) return;
      const saved = renameRoute(oldName, newName.trim());
      refreshSavedSelect();
      savedSelect.value = saved;
      if (routeNameInp) routeNameInp.value = saved;
      alert("Ruta renombrada ✅");
    }catch(e){ alert(e.message || "No se pudo renombrar."); }
  });

  deleteNamedBtn?.addEventListener("click", ()=>{
    try{
      const name = savedSelect?.value || "";
      if(!name) return alert("Elegí una ruta para borrar.");
      if(!confirm(`¿Borrar la ruta "${name}"?`)) return;
      deleteRouteByName(name);
      refreshSavedSelect();
      alert("Ruta borrada 🗑️");
    }catch(e){ alert(e.message || "No se pudo borrar."); }
  });

  exportNamedBtn?.addEventListener("click", ()=>{
    try{ const name = savedSelect?.value || ""; exportRouteJSON(name); }
    catch(e){ alert(e.message || "No se pudo exportar."); }
  });

  importNamedInp?.addEventListener("change", async ()=>{
    try{
      const file = importNamedInp.files?.[0]; if(!file) return;
      await importRouteJSONFile(file);
      refreshSavedSelect();
      importNamedInp.value = "";
      alert("Ruta(s) importada(s) ✅");
    }catch(e){ alert(e.message || "No se pudo importar."); }
  });

  /* ==========================================================
     Flujo principal
     ========================================================== */
  async function updateFromText(){
    try{
      setStatus("Leyendo entradas…");
      state.rawRows = parseInputText();
      const n = state.rawRows.length;
      if(!n){
        renderTable();
        resultsEl.innerHTML = `<p class="text-slate-700">Aún sin resultados.</p>`;
        updateNavLinksAndAPI([]);
        setStatus("Esperando entradas…");
        return;
      }
      setStatus(`Procesando ${n} punto${n>1?'s':''}…`);

      for(let idx=0; idx<state.rawRows.length; idx++){
        const r = state.rawRows[idx];
        if(!r.lat || !r.lng){
          setStatus(`Geocodificando ${idx+1}/${n}…`);
          const g = await geocode(r.address);
          if(g) Object.assign(r,g);
          await sleep(30);
        }
      }

      renderTable();
      setStatus("Generando cronograma…");

      state.schedule = buildSchedule(state.rawRows);
      state.totalKm = 0;
      for(let i=0;i<state.rawRows.length-1;i++){
        state.totalKm += haversine(state.rawRows[i], state.rawRows[i+1]);
      }
      state.totalMin = state.schedule.length ? (state.schedule[state.schedule.length-1].depart || 0) : 0;

      renderResultsSummary({ stops: state.rawRows.length, km: state.totalKm, min: state.totalMin });

      setStatus("Armando enlaces de navegación…");
      const points = state.rawRows.map(r=> {
        const hasAddr = typeof r.address === "string" && r.address.trim().length>0;
        const hasCoords = typeof r.lat === "number" && typeof r.lng === "number";
        if (hasAddr) return { address: r.address.trim() };
        if (hasCoords) return { lat: r.lat, lng: r.lng };
        return null;
      }).filter(Boolean);
      updateNavLinksAndAPI(points);

      setStatus("Listo ✅");
    }catch(e){
      console.error(e);
      setStatus("Ocurrió un error. Revisá la consola.");
      alert("Ocurrió un error procesando las direcciones.");
    }
  }

  /* ==========================================================
     Acciones UI
     ========================================================== */
  $("#updateBtn")?.addEventListener("click", updateFromText);
  $("#oneClick")?.addEventListener("click", updateFromText);
  $("#clearBtn")?.addEventListener("click", ()=>{
    if(linksTA) linksTA.value = "";
    state.rawRows = []; state.schedule = [];
    renderTable();
    resultsEl.innerHTML = `<p class="text-slate-700">Aún sin resultados.</p>`;
    updateNavLinksAndAPI([]);
    setStatus("Esperando entradas…");
  });
  $("#copyOrder")?.addEventListener("click", async ()=>{
    if(!state.rawRows.length) return alert("Primero cargá direcciones.");
    const txt = state.rawRows.map((r,i)=> `${i+1}. ${r.name ? r.name+" | " : ""}${r.address || ""}`).join("\n");
    await navigator.clipboard.writeText(txt);
  });
  $("#exportCsv")?.addEventListener("click", ()=>{
    if(!state.rawRows.length) return alert("Primero cargá direcciones.");
    const head = ["orden","local","direccion","lat","lng","precision","dwell","abre","cierra"];
    const csvRows = state.rawRows.map((r,idx)=>[ idx+1, r.name||"", r.address||"", r.lat??"", r.lng??"", r.prec??"", r.dwell??"", r.open||"", r.close||"" ]);
    const csv = head.join(",")+"\n"+csvRows.map(r=> r.map(c=> `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download="ruta.csv"; a.click(); URL.revokeObjectURL(url);
  });

  // Impresión de cronograma (si tenés un botón #printBtn)
  $("#printBtn")?.addEventListener("click", ()=>{
    if(!state.schedule.length) return alert("Generá el cronograma primero.");
    const rows = state.schedule.map(s=>`
      <tr>
        <td>${s.idx}</td><td>${s.name||"-"}</td><td>${s.address}</td>
        <td>${minToTimeStr(s.arrive)}</td><td>${minToTimeStr(s.depart)}</td>
        <td>${s.travelMin} min</td><td>${s.waitMin} min</td>
      </tr>`).join("");
    const html = `
      <html><head><meta charset="utf-8"><title>Cronograma</title>
      <style>
        body{font-family:system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color:#0f172a; margin:16px;}
        table{width:100%; border-collapse:collapse; font-size:12px;}
        th,td{border:1px solid #e2e8f0; padding:6px 8px; text-align:left;}
        th{background:#f8fafc;}
        thead{display:table-header-group;}
      </style></head><body>
      <h2>Cronograma</h2>
      <div style="margin-bottom:8px;color:#334155;">Paradas: ${state.schedule.length} · Distancia: ${fmt(state.totalKm,1)} km · Duración: ${fmt(state.totalMin,0)} min</div>
      <table><thead><tr><th>#</th><th>Local</th><th>Dirección</th><th>Llega</th><th>Sale</th><th>Traslado</th><th>Espera</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),50));</script>
      </body></html>`;
    const w = window.open("", "_blank");
    w.document.open(); w.document.write(html); w.document.close();
  });

  // Auto: si existe #autoRun, al pegar texto se dispara el update
  linksTA?.addEventListener("input", ()=>{
    const lines = (linksTA.value||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    setStatus(lines.length ? `Detectadas ${lines.length} línea(s)…` : "Esperando entradas…");
    if (autoRunEl?.checked && lines.length) {
      clearTimeout(window.__autoRunTO);
      window.__autoRunTO = setTimeout(updateFromText, 400);
    }
  });

  /* ==========================================================
     Firebase Auth listener: auto-sync al loguearte
     ========================================================== */
  (function initAuthSync(){
    try{
      const { auth } = fb();
      if (!auth || !auth.onAuthStateChanged) return;
      auth.onAuthStateChanged(async (user)=>{
        window.currentUserUid = user?.uid || null;
        if (user?.uid) {
          setStatus("Sincronizando rutas de la nube…");
          try{
            await cloudPullMergeToLocal(user.uid);
            refreshSavedSelect();
            setStatus("Listo ✅");
          }catch(e){
            console.warn(e);
            setStatus("Sincronización parcial (offline)");
          }
        }
      });
    }catch(e){ console.warn("Auth listener error", e); }
  })();

  // Estado inicial
  setStatus("Esperando entradas…");
  try{ refreshSavedSelect(); }catch{}
})();