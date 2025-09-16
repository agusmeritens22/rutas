// Columna "Local" + Ventanas horarias + Botón Actualizar + Firebase cloud sync
const $ = (id) => document.getElementById(id);

let points = []; let startPoint = null; let debounceTimer = null;
function setStatus(msg){ $("status").textContent = msg; }

// ==== Helpers horarios ====
function parseHHMM(s){ if(!s) return null; const m=s.match(/^(\d{1,2}):(\d{2})$/); if(!m) return null; let hh=Math.min(23,Math.max(0,parseInt(m[1],10))); let mm=Math.min(59,Math.max(0,parseInt(m[2],10))); return hh*60+mm; }
function minutesToHHMM(total){ total=Math.round(total); let hh=Math.floor(total/60)%24; let mm=total%60; return String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0'); }

// ====== Named routes (localStorage) ======
const LS_KEY='saved_routes_timewin_v3_local';
const loadSavedRoutes=()=>{ try{return JSON.parse(localStorage.getItem(LS_KEY)||'[]');}catch{return[];} };
const saveSavedRoutes=(arr)=> localStorage.setItem(LS_KEY, JSON.stringify(arr));
function refreshSavedSelect(){ const sel=$("savedSelect"); const arr=loadSavedRoutes(); sel.innerHTML=''; arr.forEach(r=>{ const o=document.createElement('option'); o.value=r.id; o.textContent=`${r.name} (${(r.points||[]).length} pts)`; sel.appendChild(o); }); }
function captureRouteObject(name){
  return { id:'r_'+Date.now(), name:name||'Ruta sin nombre', created_at:new Date().toISOString(),
    textarea:$("links").value,
    points: points.map(p=>({ local:p.local||'', name:p.name||p.address||'', address:p.address||'', lat:p.lat, lng:p.lng, precision:p.precision||null, dwell: p.dwell||0, open:p.open||'', close:p.close||'' })) };
}
function applyRouteObject(r){
  $("routeName").value=r.name||''; $("links").value=r.textarea||'';
  points=(r.points||[]).map((p,i)=>({ id:i+1, local:p.local||'', name:p.name||p.address||'', address:p.address||'', lat:p.lat, lng:p.lng, precision:p.precision||null, dwell:p.dwell||0, open:p.open||'', close:p.close||'' }));
  renderInputTable(); setStatus('Ruta cargada.');
}
function onSaveNamed(){ const name=($("routeName").value||'').trim(); if(!name) return alert('Poné un nombre.');
  const arr=loadSavedRoutes(); const obj=captureRouteObject(name); arr.push(obj); saveSavedRoutes(arr); refreshSavedSelect(); alert('Ruta guardada (local) ✅'); return obj; }
function onUpdateNamed(){ const id=$("savedSelect").value; if(!id) return alert('Elegí una ruta.'); const name=($("routeName").value||'').trim();
  const arr=loadSavedRoutes(); const i=arr.findIndex(x=>x.id===id); if(i<0) return alert('No se encontró.');
  arr[i]=captureRouteObject(name||arr[i].name); arr[i].id=id; arr[i].name=name||arr[i].name; saveSavedRoutes(arr); refreshSavedSelect(); alert('Ruta actualizada (local) ✅'); return arr[i]; }
function onLoadNamed(){ const id=$("savedSelect").value; if(!id) return alert('Elegí una ruta.'); const arr=loadSavedRoutes(); const r=arr.find(x=>x.id===id); if(!r) return alert('No se encontró.'); applyRouteObject(r); }
function onRenameNamed(){ const id=$("savedSelect").value; if(!id) return alert('Elegí una ruta.'); const arr=loadSavedRoutes(); const r=arr.find(x=>x.id===id); if(!r) return alert('No se encontró.');
  const newName=prompt('Nuevo nombre:', r.name||''); if(newName&&newName.trim()){ r.name=newName.trim(); saveSavedRoutes(arr); refreshSavedSelect(); } }
function onDeleteNamedLocal(){ const id=$("savedSelect").value; if(!id) return alert('Elegí una ruta.'); if(!confirm('¿Borrar la ruta seleccionada (local)?')) return; const arr=loadSavedRoutes().filter(r=>r.id!==id); saveSavedRoutes(arr); refreshSavedSelect(); }

// ====== Parse / geocode ======
function extractHouseNumber(s){ if(!s) return null; const m=s.match(/(\b\d{1,5}\b)(?!.*\b\d{1,5}\b)/); return m?m[1]:null; }
function parseNameAndAddress(line) {
  const m = line.split('|');
  if (m.length >= 2) return { local: m[0].trim(), address: m.slice(1).join('|').trim() };
  const dash = line.split(' - ');
  if (dash.length >= 2) return { local: dash[0].trim(), address: dash.slice(1).join(' - ').trim() };
  return { local: '', address: line.trim() };
}
function parseLine(raw){
  const t=(raw||'').trim(); if(!t) return null;
  let m=t.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/); if(m) return {lat:parseFloat(m[1]), lng:parseFloat(m[2]), source:'coords', address:null, local:''};
  if(/^https?:\/\//i.test(t)){
    try{ const u=new URL(t);
      m=t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/); if(m) return {lat:parseFloat(m[1]), lng:parseFloat(m[2]), source:'@', address:null, local:''};
      m=t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/); if(m) return {lat:parseFloat(m[1]), lng:parseFloat(m[2]), source:'!3d!4d', address:null, local:''};
      const q=u.searchParams.get('q'); if(q){ const qm=q.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/); if(qm) return {lat:parseFloat(qm[1]), lng:parseFloat(qm[2]), source:'q', address:null, local:''}; }
      const origin=u.searchParams.get('origin'); const dest=u.searchParams.get('destination'); const wps=u.searchParams.get('waypoints');
      const parts=[]; if(origin) parts.push(origin); if(wps) wps.split('|').forEach(p=>parts.push(p)); if(dest) parts.push(dest);
      if(parts.length) return {multi:parts.map(decodeURIComponent), source:'dir'};
      return {address:t, source:'url-address', local:''};
    }catch(_){}
  }
  const pa = parseNameAndAddress(t);
  return {address: pa.address, source:'text-address', local: pa.local};
}

function parseAll(){
  const defD = Math.max(0, parseInt($("defaultDwell").value||'0',10));
  const defOpen = $("defaultOpen").value || '';
  const defClose = $("defaultClose").value || '';

  const prev = points.slice();
  function findPrevLike(obj){
    const key = (obj.address||obj.name||'').trim().toLowerCase();
    let cand = prev.find(p=> ((p.address||p.name||'').trim().toLowerCase())===key );
    if(!cand && typeof obj.lat==='number' && typeof obj.lng==='number'){
      cand = prev.find(p=> typeof p.lat==='number' && typeof p.lng==='number' &&
        Math.abs(p.lat-obj.lat)<1e-7 && Math.abs(p.lng-obj.lng)<1e-7 );
    }
    return cand;
  }

  const lines=$("links").value.split('\n').map(s=>s.trim()).filter(Boolean);
  const out=[]; let id=1;
  for(const line of lines){
    const info=parseLine(line); if(!info) continue;
    if(info.multi && info.multi.length){
      info.multi.forEach(seg=>{
        const m=seg.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
        const obj = { id:id++, local:'', name: m? null: seg, address: m? null: seg, lat: m? parseFloat(m[1]): null, lng: m? parseFloat(m[2]): null };
        const old = findPrevLike(obj);
        out.push({
          ...obj,
          local: old? (old.local||'') : '',
          dwell: old? (old.dwell||0) : defD,
          open:  old? (old.open||'')  : defOpen,
          close: old? (old.close||'') : defClose,
          precision: old? (old.precision||null): null
        });
      });
    } else if(info.address){
      const obj = { id:id++, local: info.local||'', name: info.address, address: info.address, lat: null, lng: null };
      const old = findPrevLike(obj);
      out.push({
        ...obj,
        local: (info.local||'') || (old? (old.local||''): ''),
        dwell: old? (old.dwell||0) : defD,
        open:  old? (old.open||'')  : defOpen,
        close: old? (old.close||'') : defClose,
        precision: old? (old.precision||null): null
      });
    } else {
      const obj = { id:id++, local:'', name: '', address: null, lat: info.lat, lng: info.lng };
      const old = findPrevLike(obj);
      out.push({
        ...obj,
        local: old? (old.local||'') : '',
        dwell: old? (old.dwell||0) : defD,
        open:  old? (old.open||'')  : defOpen,
        close: old? (old.close||'') : defClose,
        precision: old? (old.precision||null): null
      });
    }
  }
  points=out; renderInputTable();
}

async function geocodeAddress(addr){
  const cfg = window.GEOCODER || {};
  if (cfg.provider !== 'opencage' || !cfg.key) {
    throw new Error('Geocoder no configurado (OpenCage).');
  }

  const url = `https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(addr)}&key=${cfg.key}&language=es&limit=5&no_annotations=1`;

  const res = await fetch(url);
  if (!res.ok) {
    // 402 = quota, 403 = key inválida o restringida, etc.
    const msg = `Geocoder HTTP ${res.status}`;
    console.error(msg);
    throw new Error(msg);
  }

  const data = await res.json();
  if (!data || !data.results || !data.results.length) {
    return null;
  }

  // Intentar casar número de puerta exacto si viene en la dirección original
  const desired = extractHouseNumber(addr);
  let best = data.results[0];

  if (desired) {
    const exact = data.results.find(r => {
      const hn = r.components && (r.components.house_number || r.components['house_number']);
      return hn && String(hn) === String(desired);
    });
    if (exact) best = exact;
  }

  return {
    lat: best.geometry.lat,
    lng: best.geometry.lng,
    name: best.formatted,
    precision: desired
      ? ((best.components && String(best.components.house_number) === String(desired)) ? 'Exacta' : 'Aprox.')
      : 'Aprox.'
  };
}

async function geocodeMissing(){
  let c=0;
  for(const p of points){
    if(typeof p.lat==='number' && typeof p.lng==='number') continue;
    const address=(p.name&&p.name.trim()) || (p.address&&p.address.trim()); if(!address) continue;
    setStatus(`Geocodificando: ${address.slice(0,80)}…`);
    try{ const g=await geocodeAddress(address);
      if(g && typeof g.lat==='number' && typeof g.lng==='number'){
        p.lat=g.lat; p.lng=g.lng; if(!p.name) p.name=g.name; p.precision=g.precision||'Aprox.'; c++; renderInputTable();
      }
    }catch(e){ console.error(e); }
    await new Promise(r=>setTimeout(r, 1000));
  }
  setStatus(`Geocodificación completa (${c} resueltas).`);
}

// ====== Distancias / ruteo ======
function haversine(a,b){ if(!a||!b) return Infinity; const R=6371,toRad=d=>d*Math.PI/180;
  const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng), lat1=toRad(a.lat), lat2=toRad(b.lat);
  const h=Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2; return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h)); }

function planWithTimeWindows(stops, start, avgSpeedKmh, startMinutes){
  const remaining = stops.slice();
  const route = [];
  let cur = start;
  let timeMin = startMinutes;
  while(remaining.length){
    let bestIndex = -1, bestScore = Infinity, bestETA = 0, bestWait=0;
    for(let i=0;i<remaining.length;i++){
      const p = remaining[i];
      const km = haversine(cur, p);
      const driveMin = (km / Math.max(1,avgSpeedKmh)) * 60;
      const eta = timeMin + driveMin;
      const openMin = parseHHMM(p.open||'') ?? -Infinity;
      const closeMin = parseHHMM(p.close||'') ?? Infinity;
      const wait = Math.max(0, openMin - eta);
      const arrival = eta + wait;
      const late = Math.max(0, arrival - closeMin);
      const feasible = (arrival <= closeMin);
      const score = (feasible?0:1e6) + (isFinite(closeMin)?closeMin:1e5)/10 + driveMin + wait + late*100;
      if(score < bestScore){ bestScore = score; bestIndex=i; bestETA = arrival; bestWait=wait; }
    }
    const chosen = remaining.splice(bestIndex,1)[0];
    const dwellMin = Math.max(0, parseInt(chosen.dwell||0,10));
    chosen.__eta = Math.round(bestETA);
    chosen.__wait = Math.round(bestWait);
    chosen.__dep  = Math.round(bestETA + dwellMin);
    route.push(chosen);
    timeMin = chosen.__dep;
    cur = chosen;
  }
  return route;
}
function twoOptDistanceOnly(route, start){ if(route.length<4) return route; let improved=true;
  const dist=(seq)=>{ let s=0,prev=start; for(const p of seq){ s+=haversine(prev,p); prev=p; } return s; };
  while(improved){ improved=false; for(let i=0;i<route.length-2;i++){ for(let k=i+2;k<route.length;k++){
    const nr=route.slice(0,i+1).concat(route.slice(i+1,k+1).reverse()).concat(route.slice(k+1));
    if(dist(nr)+1e-9<dist(route)){ route=nr; improved=true; } } } } return route; }

function buildDirLinks(order,startPoint,circular=false,chunkTotal=10){
  const pts=[]; if(startPoint) pts.push(startPoint); order.forEach(p=>pts.push(p)); if(circular&&startPoint) pts.push(startPoint);
  if(pts.length<2) return []; const chunks=[]; let i=0;
  while(i<pts.length-1){
    const slice=pts.slice(i,Math.min(i+chunkTotal,pts.length)); if(slice.length<2) break;
    const origin=slice[0], destination=slice[slice.length-1], waypoints=slice.slice(1,slice.length-1);
    const base='https://www.google.com/maps/dir/?api=1';
    const wp=waypoints.map(p=>`${p.lat},${p.lng}`).join('|');
    const url=`${base}&origin=${encodeURIComponent(origin.lat+','+origin.lng)}&destination=${encodeURIComponent(destination.lat+','+destination.lng)}${wp?`&waypoints=${encodeURIComponent(wp)}`:''}&travelmode=driving`;
    chunks.push({from:origin,to:destination,url}); i += (slice.length-1);
  }
  return chunks;
}

function renderInputTable(){
  const wrap=$('inputTableWrap'); const tbody=$('inputTable');
  if(!points.length){ wrap.classList.add('hidden'); tbody.innerHTML=''; return; }
  wrap.classList.remove('hidden'); tbody.innerHTML='';
  points.forEach((p,idx)=>{
    const tr=document.createElement('tr'); tr.className= idx%2?'bg-slate-50':'';
    const name=(p.name||p.address||'').trim() || `Punto ${idx+1}`;
    const prec = p.precision || '-';
    const dwell = Math.max(0, parseInt(p.dwell||0,10));
    tr.innerHTML=`
      <td class="py-2 pr-3 text-slate-500">${idx+1}</td>
      <td class="py-2 pr-3"><input data-id="${p.id||idx+1}" data-field="local" type="text" value="${(p.local||'').replace(/"/g,'&quot;')}" class="w-48 p-1 border rounded text-xs" placeholder="Nombre del local" /></td>
      <td class="py-2 pr-3">${name}</td>
      <td class="py-2 pr-3">${typeof p.lat==='number'? p.lat.toFixed(6): ''}</td>
      <td class="py-2 pr-3">${typeof p.lng==='number'? p.lng.toFixed(6): ''}</td>
      <td class="py-2 pr-3 ${prec==='Exacta'?'text-emerald-600':'text-amber-600'}">${prec}</td>
      <td class="py-2 pr-3"><input data-id="${p.id||idx+1}" data-field="dwell" type="number" min="0" step="1" value="${dwell}" class="w-20 p-1 border rounded text-xs" /></td>
      <td class="py-2 pr-3"><input data-id="${p.id||idx+1}" data-field="open" type="time" value="${p.open||''}" class="p-1 border rounded text-xs" /></td>
      <td class="py-2 pr-3"><input data-id="${p.id||idx+1}" data-field="close" type="time" value="${p.close||''}" class="p-1 border rounded text-xs" /></td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('input').forEach(inp=>{
    inp.addEventListener('change',(e)=>{
      const id=e.target.getAttribute('data-id');
      const field=e.target.getAttribute('data-field');
      const p=points.find(x=>String(x.id)===String(id));
      if(!p) return;
      if(field==='local'){ p.local = e.target.value||''; }
      if(field==='dwell'){ p.dwell = Math.max(0, parseInt(e.target.value||'0',10)); }
      if(field==='open'){ p.open = e.target.value||''; }
      if(field==='close'){ p.close = e.target.value||''; }
    });
  });
}

async function pickStartPoint(){
  const useGeo=$("useGeo").checked;
  if(!useGeo){ const first=points[0]; return first? {lat:first.lat, lng:first.lng, name:first.name||'Inicio (1er punto)'} : null; }
  if(!navigator.geolocation){ setStatus('Geolocalización no disponible.'); const first=points[0]; return first? {lat:first.lat, lng:first.lng, name:first.name||'Inicio (1er punto)'} : null; }
  return new Promise((resolve)=>{
    navigator.geolocation.getCurrentPosition(
      pos=>resolve({lat:pos.coords.latitude,lng:pos.coords.longitude,name:'Mi ubicación'}),
      _=>{ const first=points[0]; resolve(first? {lat:first.lat, lng:first.lng, name:first.name||'Inicio (1er punto)'} : null); },
      {enableHighAccuracy:true, timeout:5000}
    );
  });
}

function renderResults(order, startMin, avgSpeed, circular){
  let prev = startPoint || order[0];
  let totalKm=0, driveMin=0;
  for(const p of order){ const km=haversine(prev,p); totalKm+=km; driveMin+=(km/Math.max(1,avgSpeed))*60; prev=p; }
  if(circular && startPoint){ const km=haversine(prev,startPoint); totalKm+=km; driveMin+=(km/Math.max(1,avgSpeed))*60; }
  const totalDwell = order.reduce((s,p)=> s + Math.max(0,parseInt(p.dwell||0,10)), 0);
  const totalWait = order.reduce((s,p)=> s + Math.max(0, parseInt(p.__wait||0,10)), 0);
  const totalMinutes = Math.round(driveMin + totalDwell + totalWait);
  const hhDrive=Math.floor(driveMin/60), mmDrive=Math.round(driveMin%60);
  const hhTotal=Math.floor(totalMinutes/60), mmTotal=totalMinutes%60;

  const rowsHtml = order.map((p,i)=>{
    const eta = p.__eta ?? startMin;
    const dep = p.__dep ?? (eta + Math.max(0, parseInt(p.dwell||0,10)));
    const label = (p.local && p.local.trim()) ? `${p.local} — ${(p.name||p.address||'')}` : (p.name||p.address||'');
    return `<tr class="border-b">
      <td class="py-1 pr-2">${i+1}</td>
      <td class="py-1 pr-2">${label}</td>
      <td class="py-1 pr-2">${p.open||'-'}</td>
      <td class="py-1 pr-2">${p.close||'-'}</td>
      <td class="py-1 pr-2">${Math.max(0, parseInt(p.__wait||0,10))} min</td>
      <td class="py-1 pr-2">${Math.max(0, parseInt(p.dwell||0,10))} min</td>
      <td class="py-1 pr-2 mono">${minutesToHHMM(eta)}</td>
      <td class="py-1 pr-2 mono">${minutesToHHMM(dep)}</td>
    </tr>`;
  }).join('');

  $("results").innerHTML = `
    <div class="text-sm space-y-2">
      <div><span class="font-semibold">Paradas:</span> ${order.length}${circular?' (circular)':''}</div>
      <div><span class="font-semibold">Distancia estimada:</span> ${totalKm.toFixed(1).replace('.',',')} km</div>
      <div><span class="font-semibold">Conducción:</span> ${hhDrive}h ${mmDrive}m</div>
      <div><span class="font-semibold">Espera total:</span> ${totalWait} min</div>
      <div><span class="font-semibold">Estadía total:</span> ${totalDwell} min</div>
      <div class="text-sky-700"><span class="font-semibold">Duración total:</span> ${hhTotal}h ${mmTotal}m</div>

      <details class="mt-2" open>
        <summary class="cursor-pointer font-semibold">Cronograma (con ventanas horarias)</summary>
        <div class="overflow-x-auto mt-2">
          <table class="min-w-full text-xs">
            <thead>
              <tr class="text-left text-slate-600">
                <th class="py-1 pr-2">#</th>
                <th class="py-1 pr-2">Parada (Local — Dirección)</th>
                <th class="py-1 pr-2">Abre</th>
                <th class="py-1 pr-2">Cierra</th>
                <th class="py-1 pr-2">Espera</th>
                <th class="py-1 pr-2">Estadía</th>
                <th class="py-1 pr-2">Llega</th>
                <th class="py-1 pr-2">Sale</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </details>
    </div>`;
}

function fullParse(){ parseAll(); renderInputTable(); }

async function fullFlow(){
  setStatus('Leyendo…'); fullParse();
  const needGeo = points.some(p=> !(typeof p.lat==='number' && typeof p.lng==='number'));
  if(needGeo){ await geocodeMissing(); }
  if(points.length<2){ setStatus('Necesitás al menos 2 puntos.'); return; }
  setStatus('Optimizando…');

  const startTimeStr = $("startTime").value || "08:00";
  const startMin = parseHHMM(startTimeStr) ?? 8*60;
  const avgSpeed = Math.max(1, parseFloat($("avgSpeed").value)||40);
  const circular = $("circular").checked;
  startPoint = await pickStartPoint();

  let route = planWithTimeWindows(points.map(p=>({...p})), startPoint||points[0], avgSpeed, startMin);
  route = twoOptDistanceOnly(route, startPoint||route[0]);
  renderResults(route, startMin, avgSpeed, circular);

  const chunks=buildDirLinks(route, (startPoint||route[0]), circular, 10);
  const wrap=$("dirLinks"); wrap.innerHTML='';
  chunks.forEach((ch,idx)=>{
    const div=document.createElement('div'); div.className='p-2 border rounded-lg flex items-center justify-between gap-3';
    div.innerHTML=`
      <div>
        <div class="text-xs text-slate-500">Tramo ${idx+1}:</div>
        <div class="mono text-xs">${ch.from.lat.toFixed(4)},${ch.from.lng.toFixed(4)} → ${ch.to.lat.toFixed(4)},${ch.to.lng.toFixed(4)}</div>
      </div>
      <a href="${ch.url}" target="_blank" rel="noopener" class="px-3 py-1.5 rounded-lg bg-sky-700 text-white hover:bg-sky-800">Abrir</a>`;
    wrap.appendChild(div);
  });

  setStatus('Listo ✅');
}

// ====== Eventos UI ======
$("links").addEventListener('input', ()=>{ if($("autoRun").checked){ clearTimeout(debounceTimer); debounceTimer=setTimeout(fullFlow, 1200); } });
$("oneClick").addEventListener('click', fullFlow);
$("updateBtn").addEventListener('click', ()=>{ setStatus('Actualizando…'); fullFlow(); });
$("clearBtn").addEventListener('click', ()=>{ $("links").value=''; points=[]; renderInputTable(); $("results").innerHTML='<p class="text-slate-500">Aún sin resultados.</p>'; $("dirLinks").innerHTML=''; setStatus('Esperando entradas…'); });

// Guardado local + nube
$("saveNamed").addEventListener('click', async () => {
  const name = ($("routeName").value||'').trim();
  if(!name) return alert('Poné un nombre.');
  const obj = onSaveNamed(); // local
  try { await cloudSaveNamed(name, obj.id); } catch(e){ console.error(e); alert("No se pudo guardar en la nube"); }
});

$("updateNamed").addEventListener('click', async () => {
  const updated = onUpdateNamed(); // local
  if(updated){
    try { await cloudSaveNamed(updated.name, updated.id); } catch(e){ console.error(e); }
  }
});

$("loadNamed").addEventListener('click', onLoadNamed);
$("renameNamed").addEventListener('click', onRenameNamed);

$("deleteNamed").addEventListener('click', async () => {
  const id=$("savedSelect").value; if(!id) return alert('Elegí una ruta.');
  onDeleteNamedLocal(); // local
  try { await cloudDelete(id); } catch(e){ console.warn("No se pudo borrar en la nube (quizás no existe):", e); }
});

$("exportNamed").addEventListener('click', onExportNamed);
$("importNamed").addEventListener('change', (e)=>{ const f=e.target.files[0]; if(f) onImportNamed(f); e.target.value=''; });

// Export CSV con columna "local"
$("exportCsv").addEventListener('click', ()=>{
  if(!points.length){ alert('No hay puntos.'); return; }
  const header=['orden','local','direccion','lat','lng','dwell_min','abre','cierra'];
  const rows=[header].concat(points.map((p,i)=>[
    i+1,
    (p.local||'').replaceAll('"','""'),
    (p.name||p.address||'').replaceAll('"','""'),
    p.lat, p.lng,
    Math.max(0,parseInt(p.dwell||0,10)),
    p.open||'', p.close||''
  ]));
  const csv = rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='rutas_puntos_ventanas.csv'; a.click(); URL.revokeObjectURL(a.href);
});

// Atajo: Ctrl/Cmd + Enter -> Actualizar
document.addEventListener('keydown', (e) => {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  if ((isMac ? e.metaKey : e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    $("updateBtn").click();
  }
});

// ====== Firebase (Cloud) ======
// Requiere que en index.html hayas inicializado window._firebase con db/auth/etc.
async function cloudSaveNamed(name, forcedId){
  const fb = window._firebase;
  if(!fb){ console.warn("Firebase no inicializado"); return; }
  const { db, auth, doc, setDoc } = fb;
  const user = auth.currentUser;
  if(!user) { alert("Esperando autenticación…"); return; }
  // Si viene un id (de onSaveNamed/onUpdateNamed) lo usamos; si no, capturamos nuevo
  const routeObj = forcedId ? { ...captureRouteObject(name), id: forcedId } : captureRouteObject(name);
  await setDoc(doc(db, "users", user.uid, "routes", routeObj.id), routeObj);
  setStatus("Ruta guardada en la nube ☁️");
}

async function cloudList(){
  const fb = window._firebase; if(!fb) return [];
  const { db, auth, collection, getDocs } = fb;
  const user = auth.currentUser; if(!user) return [];
  const snap = await getDocs(collection(db, "users", user.uid, "routes"));
  return snap.docs.map(d => d.data());
}

async function cloudSyncToLocal(){
  try {
    const list = await cloudList();        // lee todas tus rutas en Firestore
    if(!list || !list.length) return;      // si no hay, nada que hacer
    const locales = loadSavedRoutes();     // las que tenés en localStorage
    const byId = Object.fromEntries(locales.map(r => [r.id, r]));
    list.forEach(r => { byId[r.id] = r; }); // mergea por id (nube pisa local)
    const merged = Object.values(byId);
    saveSavedRoutes(merged);
    refreshSavedSelect();
    setStatus("Sincronizado con la nube al iniciar ☁️");
  } catch(e){
    console.error("cloudSyncToLocal:", e);
  }
}


async function cloudDelete(id){
  const fb = window._firebase; if(!fb) return;
  const { db, auth, doc, deleteDoc } = fb;
  const user = auth.currentUser; if(!user) return;
  await deleteDoc(doc(db, "users", user.uid, "routes", id));
  setStatus("Ruta borrada de la nube 🗑️");
}

// Sincronizar listado nube -> local (cuando abrís el select o si querés, ponelo en un botón)
$("savedSelect").addEventListener('focus', async () => {
  try {
    const list = await cloudList();
    if(!list.length) return;
    const locales = loadSavedRoutes();
    const byId = Object.fromEntries(locales.map(r=>[r.id, r]));
    list.forEach(r => { byId[r.id] = r; });
    const merged = Object.values(byId);
    saveSavedRoutes(merged);
    refreshSavedSelect();
    setStatus("Sincronizado con la nube ☁️");
  } catch(e){ console.error(e); }
});

// Inicial UI
refreshSavedSelect();

async function cloudSyncToLocal(){
  try {
    const list = await cloudList();
    if(!list || !list.length) return;
    const locales = loadSavedRoutes();
    const byId = Object.fromEntries(locales.map(r => [r.id, r]));
    list.forEach(r => { byId[r.id] = r; });
    const merged = Object.values(byId);
    saveSavedRoutes(merged);
    refreshSavedSelect();
    setStatus("Sincronizado con la nube al iniciar ☁️");
  } catch(e){
    console.error("cloudSyncToLocal:", e);
  }
}

// Auto-sync al cargar (cuando Auth esté lista)
(function autoSyncOnLoad(){
  if (window._firebase && window._firebase.auth && window._firebase.onAuthStateChanged) {
    window._firebase.onAuthStateChanged(window._firebase.auth, async (user) => {
      if (user) { await cloudSyncToLocal(); }
    });
    return;
  }
  let tries = 0;
  const t = setInterval(() => {
    if (window._firebase && window._firebase.auth && window._firebase.onAuthStateChanged) {
      clearInterval(t);
      window._firebase.onAuthStateChanged(window._firebase.auth, async (user) => {
        if (user) { await cloudSyncToLocal(); }
      });
    }
    if (++tries > 40) clearInterval(t); // 10s
  }, 250);
})();

// Re-sync al volver a la pestaña
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    cloudSyncToLocal();
  }
});

// (Dejalo también si ya lo tenías)
$("savedSelect").addEventListener('focus', cloudSyncToLocal);

