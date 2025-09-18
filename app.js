/* ---------- Render de tabla (adaptativa + padding cómodo) ---------- */
function renderTable() {
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
      const latVal  = r.lat?.toFixed?.(6) ?? "";
      const lngVal  = r.lng?.toFixed?.(6) ?? "";
      const precTxt = r.prec ? (r.prec >= 8 ? "Exacta" : "Aprox.") : "";

      return `
<tr class="bg-white">
  <!-- # -->
  <td class="py-3 px-4 whitespace-nowrap text-slate-600">${i + 1}</td>

  <!-- Local / Nombre (ancho mínimo, pero flexible) -->
  <td class="py-3 px-4 align-middle" style="min-width:11rem;">
    <input data-k="name" data-i="${i}" value="${nameVal}"
      class="w-full px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>

  <!-- Dirección (ocupa todo el espacio sobrante) -->
  <td class="py-3 px-4 w-full align-middle">
    <input data-k="address" data-i="${i}" value="${addrVal}"
      class="w-full px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>

  <!-- Lat / Lng (estrechas, no se rompen) -->
  <td class="py-3 px-4 whitespace-nowrap mono text-slate-700">${latVal}</td>
  <td class="py-3 px-4 whitespace-nowrap mono text-slate-700">${lngVal}</td>

  <!-- Precisión -->
  <td class="py-3 px-4 ${precTxt==='Exacta' ? 'text-emerald-700' : 'text-amber-600'}">${precTxt}</td>

  <!-- Estadía -->
  <td class="py-3 px-4 align-middle">
    <input data-k="dwell" data-i="${i}" type="number" min="0" step="1" value="${r.dwell ?? 10}"
      class="w-24 px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>

  <!-- Abre -->
  <td class="py-3 px-4 align-middle">
    <input data-k="open" data-i="${i}" type="time" value="${r.open || ''}"
      class="px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>

  <!-- Cierra -->
  <td class="py-3 px-4 align-middle">
    <input data-k="close" data-i="${i}" type="time" value="${r.close || ''}"
      class="px-3 py-2 rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500"/>
  </td>
</tr>`;
    })
    .join("");

  // Bind de cambios en celdas editables
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
