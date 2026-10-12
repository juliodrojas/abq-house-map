/* ABQ House Map — 3D interactive map of 43 active 3BR listings + supermarkets.
   Built with MapLibre GL JS (maplibre.org) + OpenFreeMap vector tiles (openfreemap.org).
   Data: listings.json, supermarkets.json (snapshot Oct 10-11, 2026). */
(function () {
  "use strict";
  var CARTOON = "https://tiles.openfreemap.org/styles/liberty";
  var SAT = {
    version: 8,
    sources: {
      esri: { type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256, attribution: "Esri World Imagery" },
      openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet" }
    },
    layers: [{ id: "esri", type: "raster", source: "esri" }]
  };
  var ABQ = [-106.62, 35.11];

  function scoreColor(t) {
    if (t >= 17) return "#22c55e";
    if (t >= 16) return "#84cc16";
    if (t >= 15) return "#eab308";
    if (t >= 14) return "#f97316";
    return "#ef4444";
  }

  var state = { minScore: 0, showStores: true, showCondos: true, is3d: true,
                cartoon: true, cluster: "", data: null, stores: null };

  var map = new maplibregl.Map({
    container: "map",
    style: CARTOON,
    center: ABQ, zoom: 10.4, pitch: 55, bearing: -12,
    attributionControl: { compact: true }
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
  map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), "bottom-right");

  function addBuildings() {
    if (map.getLayer("bldg-3d")) return;
    var before = map.getStyle().layers.map(function (l) { return l.id; })
      .find(function (id) { return /label|place|poi/i.test(id); });
    map.addLayer({
      id: "bldg-3d", type: "fill-extrusion", source: "openmaptiles",
      "source-layer": "building", minzoom: 14.5,
      paint: {
        "fill-extrusion-color": state.cartoon ? "#e5e0d5" : "#c9c2b4",
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.75
      },
      layout: { visibility: state.is3d ? "visible" : "none" }
    }, before);
  }

  function addDataLayers() {
    if (!state.data) return;
    if (!map.getSource("houses")) {
      map.addSource("houses", { type: "geojson", data: housesGeo() });
      map.addLayer({
        id: "houses", type: "circle", source: "houses",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 13, 9, 16, 13],
          "circle-color": ["match", ["get", "total"],
            17, "#22c55e", 16, "#84cc16", 15, "#eab308", 14, "#f97316", "#ef4444"],
          "circle-stroke-width": 2, "circle-stroke-color": "#fff",
          "circle-opacity": 0.92
        }
      });
    }
    if (!map.getSource("stores")) {
      map.addSource("stores", { type: "geojson", data: storesGeo() });
      map.addLayer({
        id: "stores", type: "circle", source: "stores",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3.5, 13, 6, 16, 9],
          "circle-color": "#3b82f6", "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff", "circle-opacity": 0.9
        },
        layout: { visibility: state.showStores ? "visible" : "none" }
      });
    }
    addBuildings();
    applyFilters();
  }

  function housesGeo() {
    return { type: "FeatureCollection", features: state.data.map(function (l, i) {
      return { type: "Feature", geometry: { type: "Point", coordinates: [l.lon, l.lat] },
        properties: { idx: i, total: l.total } };
    }) };
  }
  function storesGeo() {
    return { type: "FeatureCollection", features: state.stores.map(function (s, i) {
      return { type: "Feature", geometry: { type: "Point", coordinates: [s.lon, s.lat] },
        properties: { idx: i, name: s.name } };
    }) };
  }

  function applyFilters() {
    if (!map.getLayer("houses")) return;
    // JS-side filtering (flags/cluster live in the data, not the tiles)
    var feats = state.data.map(function (l, i) {
      var ok = l.total >= state.minScore &&
        (state.showCondos || l.flags.indexOf("condo") < 0) &&
        (!state.cluster || l.cluster === state.cluster);
      return { type: "Feature", geometry: { type: "Point", coordinates: [l.lon, l.lat] },
        properties: { idx: i, total: l.total, hidden: !ok } };
    });
    map.getSource("houses").setData({ type: "FeatureCollection", features: feats });
    map.setFilter("houses", ["!", ["get", "hidden"]]);
  }

  function fmt(n) { return "$" + n.toLocaleString("en-US"); }

  function openPanel(l) {
    closePanel();
    var p = document.createElement("aside");
    p.id = "detail";
    var stCls = (l.status || "").toLowerCase() === "pending" ? "pending" : "active";
    var flagHtml = l.flags.length
      ? '<div class="flags">⚠ ' + l.flags.join(" · ").toUpperCase() + (l.approx ? " · PIN APPROXIMATE" : "") + "</div>"
      : (l.approx ? '<div class="flags">⚠ PIN APPROXIMATE</div>' : "");
    var short = l.desc && l.desc.length > 150 ? l.desc.slice(0, 150) + "…" : (l.desc || "");
    var descHtml = l.desc
      ? '<p class="desc" id="pd-desc">' + esc(short) + "</p>" +
        (l.desc.length > 150 ? '<button class="more" id="pd-more">more</button>' : "")
      : "";
    var facts = [];
    if (l.dom) facts.push("DOM " + l.dom);
    if (l.taxes) facts.push("Taxes " + l.taxes);
    if (l.pp_sqft) facts.push(l.pp_sqft + "/sqft");
    if (l.year_built) facts.push("Built " + l.year_built);
    p.innerHTML =
      '<button class="close-x" id="pd-x">✕</button>' +
      '<div class="pd-tabs"><button id="pd-tab-photos" class="on">📷 Photos</button>' +
      '<button id="pd-tab-report">📋 Report</button></div>' +
      '<div id="pd-body"></div>';
    document.getElementById("app").appendChild(p);

    var body = document.getElementById("pd-body");
    var idx = 0;
    function photosView() {
      body.innerHTML =
        '<div class="photo"><img id="pd-img" src="' + l.photos[idx] + '" alt="' + esc(l.address) + '">' +
        '<span class="status ' + stCls + '">' + esc(l.status || "") + "</span>" +
        (l.photos.length > 1
          ? '<button class="car-btn prev" id="pd-prev">‹</button>' +
            '<button class="car-btn next" id="pd-next">›</button>' +
            '<span class="car-count" id="pd-count">' + (idx + 1) + " / " + l.photos.length + "</span>"
          : "") +
        "</div>" +
        '<div class="body"><div class="price">' + fmt(l.price) + "</div>" +
        "<h2>" + esc(l.address) + "</h2>" +
        '<div class="meta">' + l.beds_baths + " bd/ba · " + l.sqft.toLocaleString() +
        " sqft · " + l.zip + "<br>" + esc(l.cluster) + "</div>" +
        '<div class="scores">' +
        '<div class="score"><b>' + l.v1 + '</b>amenity</div>' +
        '<div class="score"><b>' + l.v2 + '</b>trend</div>' +
        '<div class="score"><b>' + l.v3 + '</b>safety</div>' +
        '<div class="score"><b>' + l.total + '</b>total</div></div>' +
        mortgageBox(l) +
        descHtml +
        (facts.length ? '<div class="facts">' + facts.map(esc).join(" · ") + "</div>" : "") +
        (l.office ? '<div class="office">Listed by ' + esc(l.office) + "</div>" : "") +
        '<div class="inquiry">Inquiries: <a href="tel:+15059072472">(505) 907-2472</a></div>' +
        flagHtml + "</div>";
      var show = function (d) {
        idx = (idx + d + l.photos.length) % l.photos.length;
        document.getElementById("pd-img").src = l.photos[idx];
        var c = document.getElementById("pd-count");
        if (c) c.textContent = (idx + 1) + " / " + l.photos.length;
      };
      var pv = document.getElementById("pd-prev"), nx = document.getElementById("pd-next");
      if (pv && nx) {
        pv.onclick = function (e) { e.stopPropagation(); show(-1); };
        nx.onclick = function (e) { e.stopPropagation(); show(1); };
      }
      var more = document.getElementById("pd-more");
      if (more) more.onclick = function () {
        var d = document.getElementById("pd-desc");
        var expanded = d.dataset.full === "1";
        d.textContent = expanded ? short : l.desc;
        d.dataset.full = expanded ? "" : "1";
        more.textContent = expanded ? "more" : "less";
      };
    }
    function reportView() {
      body.innerHTML = '<div class="lb-report">' + buildReport(l) + "</div>";
    }
    document.getElementById("pd-tab-photos").onclick = function () {
      this.classList.add("on");
      document.getElementById("pd-tab-report").classList.remove("on");
      photosView();
    };
    document.getElementById("pd-tab-report").onclick = function () {
      this.classList.add("on");
      document.getElementById("pd-tab-photos").classList.remove("on");
      reportView();
    };
    document.getElementById("pd-x").onclick = closePanel;
    photosView();
  }
  function closePanel() {
    var p = document.getElementById("detail");
    if (p) p.remove();
  }
  function mortgageEst(l) {
  var price = typeof l.price === "number" ? l.price : parseInt(String(l.price).replace(/[^0-9]/g, ""), 10);
  var down = Math.round(price * 0.25);
  var loan = price - down;
  var r = 0.08125 / 12, n = 360;
  var f = Math.pow(1 + r, n);
  var pi = loan * r * f / (f - 1);
  // Buyer tax: NM resets assessment to market value on sale ("tax lightning"),
  // so the buyer's bill ≈ 1.61% of price — not the seller's (capped) figure.
  var tax = price * 0.0161 / 12, ins = 110;
  return { down: down, pi: Math.round(pi), tax: Math.round(tax), ins: ins, total: Math.round(pi + tax + ins) };
}
// 3BR market rent ranges per ZIP (Oct 2026): Zillow observed rents + HUD SAFMR FY2027.
// conf: high = sources agree; med = Zillow 10-19% above HUD; low = sources disagree on direction.
var RENT_RANGES = {
  "87102": { lo: 1840, hi: 2100, conf: "med" },
  "87105": { lo: 1840, hi: 2105, conf: "med" },
  "87107": { lo: 1840, hi: 2028, conf: "med" },
  "87108": { lo: 1840, hi: 2200, conf: "med" },
  "87109": { lo: 1900, hi: 2080, conf: "low" },
  "87110": { lo: 1960, hi: 2030, conf: "high" },
  "87111": { lo: 2412, hi: 2420, conf: "high" },
  "87112": { lo: 1840, hi: 1951, conf: "med" },
  "87113": { lo: 2395, hi: 2630, conf: "high" },
  "87120": { lo: 2200, hi: 2340, conf: "high" },
  "87121": { lo: 1875, hi: 2240, conf: "low" },
  "87123": { lo: 1840, hi: 2100, conf: "med" }
};
function mortgageBox(l) {
  var m = mortgageEst(l);
  var r = RENT_RANGES[l.zip];
  var rentHtml = "", cfHtml = "";
  if (r) {
    var cfLo = r.lo - m.total, cfHi = r.hi - m.total;
    var cfTxt = (cfLo >= 0 ? "+$" : "-$") + Math.abs(cfLo).toLocaleString() +
      " to " + (cfHi >= 0 ? "+$" : "-$") + Math.abs(cfHi).toLocaleString() + "/mo";
    rentHtml = '<div class="mg-rows"><span>🏠 Est. rent (' + l.zip + "): $" + r.lo.toLocaleString() +
      "–$" + r.hi.toLocaleString() + "/mo" + (r.conf === "low" ? " ⚠" : "") + "</span></div>";
    cfHtml = '<div class="mg-cf' + (cfLo >= 0 ? " pos" : " neg") + '">📊 Cash flow: ' + cfTxt + "</div>";
  }
  return '<div class="mortgage">' +
    '<div class="mg-head">💰 Estimated monthly cost</div>' +
    '<div class="mg-total">$' + m.total.toLocaleString() + "<span>/mo</span></div>" +
    '<div class="mg-rows"><span>P&amp;I $' + m.pi.toLocaleString() + "</span>" +
    "<span>Tax $" + m.tax.toLocaleString() + "</span>" +
    "<span>Ins $" + m.ins + "</span></div>" +
    rentHtml + cfHtml +
    '<div class="mg-note">25% down ($' + m.down.toLocaleString() + ") · 30-yr fixed 8.125% · tax 1.61% of price (NM resets assessment on sale) · landlord ins ~$110/mo" +
    (r ? "<br>Rents: Zillow observed + HUD SAFMR, Oct 2026" + (r.conf === "low" ? " · ⚠ sources disagree here — verify with real listings" : "") : "") + "</div>" +
    "</div>";
}
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function buildReport(l) {
    var R = (state.reports && state.reports[l.cluster]) || {};
    var pros = [], cons = [];
    if (l.total >= 16) pros.push("Top-tier score in this 43-house set (" + l.total + "/21)");
    if (l.v3 >= 5) pros.push("Safety above the set's mid-pack");
    if (l.v3 === 7) pros.push("Best safety rating in the set");
    if (l.v2 >= 6) pros.push("Price trend pointing up");
    if (l.v1 >= 6) pros.push("Strong everyday amenities — groceries, transit, hospital");
    if ((l.status || "").toLowerCase() === "active") pros.push("Still active — available to tour and offer on");
    var ppsq = parseFloat(l.pp_sqft);
    if (ppsq && ppsq < 200) pros.push("Low price per sqft for the set ($" + l.pp_sqft + ")");
    if (l.v3 <= 2) cons.push("Safety is the weak spot — walk the block day and night before offering");
    if (l.v3 === 1) cons.push("Highest-crime cluster in the set — needs investor-grade risk tolerance");
    if (l.v2 <= 4) cons.push("Flat or soft price trend — don't count on appreciation");
    if (l.v1 <= 4) cons.push("Thinner daily amenities — groceries and transit farther");
    if ((l.status || "").toLowerCase() === "pending") cons.push("Already pending — may take backup offers only");
    if (l.flags.indexOf("condo") >= 0) cons.push("Condo: verify HOA dues, reserves, insurance and loan terms");
    if (l.flags.indexOf("duplex") >= 0) cons.push("Duplex layout: verify both units' rents and condition");
    if (parseInt(l.dom) >= 60) cons.push("Sitting 60+ days — ask why it hasn't moved");
    if (!pros.length) pros.push("Priced inside your $220K–$260K band");
    if (!cons.length) cons.push("No red flags from the scoring — still verify in person");

    function row(label, score, text) {
      return '<div class="rp-row"><div class="rp-head"><span>' + label + '</span><b>' + score + "/7</b></div>" +
        '<div class="rp-bar"><i style="width:' + Math.round(score / 7 * 100) + '%"></i></div>' +
        '<p>' + esc(text || "No detail recorded.") + "</p></div>";
    }
    var stores = (l.near || []).map(function (s) {
      return "<li>🛒 " + esc(s.name) + " — " + s.mi + " mi</li>";
    }).join("");
    return '<h3>Scoring report</h3>' +
      '<p class="rp-addr">' + esc(l.address) + " · " + esc(l.cluster) + ' · <b class="' +
      ((l.status || "").toLowerCase() === "pending" ? "pending" : "active") + '">' + esc(l.status || "") + "</b></p>" +
      row("🛡️ Safety", l.v3, R.safety) +
      row("📈 Price trend", l.v2, R.trend) +
      row("🏪 Amenities", l.v1, R.amenity) +
      '<div class="rp-row"><div class="rp-head"><span>📍 Closest groceries</span></div><ul class="rp-stores">' + stores + "</ul></div>" +
      '<div class="rp-cols"><div><h4>✅ Pros</h4><ul>' +
      pros.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") +
      "</ul></div><div><h4>⚠️ Cons</h4><ul>" +
      cons.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") +
      "</ul></div></div>" +
      '<p class="rp-fine">Scores provisional v1 (Oct 11, 2026). Safety = modeled neighborhood estimates, not block-level. Verify before offering.</p>';
  }

  function wire() {
    map.on("click", "houses", function (e) {
      var l = state.data[e.features[0].properties.idx];
      openPanel(l);
    });
    map.on("click", "stores", function (e) {
      var s = state.stores[e.features[0].properties.idx];
      new maplibregl.Popup({ closeButton: true })
        .setLngLat(e.lngLat)
        .setHTML("<b>🛒 " + esc(s.name) + "</b>" + (s.brand && s.brand !== s.name ? "<br>" + esc(s.brand) : ""))
        .addTo(map);
    });
    map.on("mouseenter", "houses", function () { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "houses", function () { map.getCanvas().style.cursor = ""; });
    map.on("mouseenter", "stores", function () { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "stores", function () { map.getCanvas().style.cursor = ""; });

    // search
    var input = document.getElementById("search"), box = document.getElementById("search-results");
    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      box.innerHTML = ""; box.style.display = "none";
      if (q.length < 2) return;
      var hits = [];
      state.data.forEach(function (l, i) {
        if ((l.address + " " + l.cluster + " " + l.zip).toLowerCase().indexOf(q) >= 0)
          hits.push({ t: "🏠", label: l.address + " — " + fmt(l.price), fn: function () {
            map.flyTo({ center: [l.lon, l.lat], zoom: 15, pitch: state.is3d ? 55 : 0 });
            openPanel(l);
          }});
      });
      state.stores.forEach(function (s) {
        if (s.name.toLowerCase().indexOf(q) >= 0 && hits.length < 12)
          hits.push({ t: "🛒", label: s.name, fn: function () {
            map.flyTo({ center: [s.lon, s.lat], zoom: 15, pitch: state.is3d ? 55 : 0 });
          }});
      });
      hits.slice(0, 10).forEach(function (h) {
        var b = document.createElement("button");
        b.innerHTML = '<span class="kind">' + h.t + "</span>" + esc(h.label);
        b.onclick = function () { box.style.display = "none"; input.value = ""; h.fn(); };
        box.appendChild(b);
      });
      if (hits.length) box.style.display = "block";
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".search-wrap")) box.style.display = "none";
    });

    // panel
    var panel = document.getElementById("panel");
    document.getElementById("menu-btn").onclick = function () { panel.classList.toggle("open"); };
    document.getElementById("panel-close").onclick = function () { panel.classList.remove("open"); };

    document.getElementById("score-btns").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      this.querySelectorAll("button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      state.minScore = +b.dataset.min; applyFilters();
    });
    function toggle(id, fn) {
      var el = document.getElementById(id);
      el.onclick = function () { el.classList.toggle("on"); fn(el.classList.contains("on")); };
    }
    toggle("tgl-stores", function (on) {
      state.showStores = on;
      if (map.getLayer("stores")) map.setLayoutProperty("stores", "visibility", on ? "visible" : "none");
    });
    toggle("tgl-condos", function (on) { state.showCondos = on; applyFilters(); });
    toggle("tgl-3d", function (on) {
      state.is3d = on;
      map.easeTo({ pitch: on ? 55 : 0, duration: 800 });
      if (map.getLayer("bldg-3d")) map.setLayoutProperty("bldg-3d", "visibility", on ? "visible" : "none");
    });
    var bc = document.getElementById("base-cartoon"), bs = document.getElementById("base-sat");
    function setBase(cartoon) {
      state.cartoon = cartoon;
      bc.classList.toggle("on", cartoon); bs.classList.toggle("on", !cartoon);
      map.setStyle(cartoon ? CARTOON : SAT);
    }
    bc.onclick = function () { setBase(true); };
    bs.onclick = function () { setBase(false); };
    map.on("styledata", addDataLayers);

    // cluster dropdown
    var sel = document.getElementById("cluster-filter");
    var clusters = [];
    state.data.forEach(function (l) { if (clusters.indexOf(l.cluster) < 0) clusters.push(l.cluster); });
    clusters.sort().forEach(function (c) {
      var o = document.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o);
    });
    sel.onchange = function () { state.cluster = sel.value; applyFilters(); };
  }

  fetch("listings.json").then(function (r) { return r.json(); }).then(function (listings) {
    return fetch("supermarkets.json").then(function (r) { return r.json(); }).then(function (stores) {
      return fetch("reports.json").then(function (r) { return r.json(); }).then(function (reports) {
        state.data = listings; state.stores = stores; state.reports = reports;
        wire();
        map.on("load", addDataLayers);
        if (map.loaded()) addDataLayers();
      });
    });
  }).catch(function (err) {
    document.getElementById("map").innerHTML =
      '<div style="padding:40px;font-family:sans-serif">Could not load map data. ' + esc(err.message) + "</div>";
  });
})();
