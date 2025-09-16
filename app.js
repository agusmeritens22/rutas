const $ = (id) => document.getElementById(id);
let points = [];

function setStatus(msg){ $("status").textContent = msg; }

function parseLine(raw){
  const t = raw.trim();
  if(!t) return null;
  return { address: t, lat: null, lng: null };
}

function parseAll(){
  const lines = $("links").value.split("\n").map(s=>s.trim()).filter(Boolean);
  points = lines.map((addr,i)=>({ id:i+1, address:addr, lat:null, lng:null }));
}

function haversine(a,b){
  if(!a||!b) return Infinity;
  const R=6371,toRad=d=>d*Math.PI/180;
  const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
  const lat1=toRad(a.lat), lat2=toRad(b.lat);
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}

function renderResults(order){
  $("results").innerHTML = "<pre>"+JSON.stringify(order,null,2)+"</pre>";
}

async function geocodeAddress(addr){
  const url=`https://api.opencagedata.com/geocode/v1/json?q=${encodeURIComponent(addr)}&key=a24210fb3d144afc8d35ad8d5e339879&language=es&limit=1`;
  const res=await fetch(url);
  const data=await res.json();
  if(data.results.length){
    return {lat:data.results[0].geometry.lat, lng:data.results[0].geometry.lng};
  }
  return null;
}

async function geocodeAll(){
  for(const p of points){
    if(!p.lat){
      const g=await geocodeAddress(p.address);
      if(g){ p.lat=g.lat; p.lng=g.lng; }
      await new Promise(r=>setTimeout(r,500));
    }
  }
}

async function fullFlow(){
  setStatus("Procesando...");
  parseAll();
  await geocodeAll();
  if(points.length<2){ setStatus("Necesitás al menos 2 puntos."); return; }
  renderResults(points);
  setStatus("Listo ✅");
}

$("oneClick").addEventListener("click", fullFlow);
$("clearBtn").addEventListener("click", ()=>{
  $("links").value="";
  points=[];
  $("results").innerHTML="";
  setStatus("Esperando entradas…");
});
