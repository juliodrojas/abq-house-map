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

  function openCard(l) {
    var card = document.getElementById("card");
    var stCls = (l.status || "").toLowerCase() === "pending" ? "pending" : "active";
    var flagHtml = l.flags.length
      ? '<div class="flags">⚠ ' + l.flags.join(" · ").toUpperCase() + (l.approx ? " · PIN APPROXIMATE" : "") + "</div>"
      : (l.approx ? '<div class="flags">⚠ PIN APPROXIMATE</div>' : "");
    var short = l.desc && l.desc.length > 150 ? l.desc.slice(0, 150) + "…" : (l.desc || "");
    var descHtml = l.desc
      ? '<p class="desc" id="card-desc">' + esc(short) + "</p>" +
        (l.desc.length > 150 ? '<button class="more" id="desc-more">more</button>' : "")
      : "";
    var facts = [];
    if (l.dom) facts.push("DOM " + l.dom);
    if (l.taxes) facts.push("Taxes " + l.taxes);
    if (l.pp_sqft) facts.push(l.pp_sqft + "/sqft");
    if (l.year_built) facts.push("Built " + l.year_built);
    card.innerHTML =
      '<button class="close-x" id="card-x">✕</button>' +
      '<div class="photo"><img id="card-img" src="' + l.photos[0] + '" alt="' + esc(l.address) + '">' +
      '<span class="status ' + stCls + '">' + esc(l.status || "") + "</span>" +
      (l.photos.length > 1
        ? '<button class="car-btn prev" id="car-prev">‹</button>' +
          '<button class="car-btn next" id="car-next">›</button>' +
          '<span class="car-count" id="car-count">1 / ' + l.photos.length + "</span>"
        : "") +
      "</div>" +
      '<div class="body"><div class="price-row"><div class="price">' + fmt(l.price) + "</div></div>" +
      "<h2>" + esc(l.address) + "</h2>" +
      '<div class="meta">' + l.beds_baths + " bd/ba · " + l.sqft.toLocaleString() +
      " sqft · " + l.zip + "<br>" + esc(l.cluster) + "</div>" +
      '<div class="scores">' +
      '<div class="score"><b>' + l.v1 + '</b>amenity</div>' +
      '<div class="score"><b>' + l.v2 + '</b>trend</div>' +
      '<div class="score"><b>' + l.v3 + '</b>safety</div>' +
      '<div class="score"><b>' + l.total + '</b>total</div></div>' +
      descHtml +
      (facts.length ? '<div class="facts">' + facts.map(esc).join(" · ") + "</div>" : "") +
      (l.office ? '<div class="office">Listed by ' + esc(l.office) + "</div>" : "") +
      '<div class="inquiry">Inquiries: <a href="tel:+15059072472">(505) 907-2472</a></div>' +
      flagHtml + "</div>";
    card.classList.remove("hidden");
    document.getElementById("card-x").onclick = function () { card.classList.add("hidden"); };
    var prev = document.getElementById("car-prev"), next = document.getElementById("car-next");
    var idx = 0, img = document.getElementById("card-img"), cnt = document.getElementById("car-count");
    var show = function (i) {
      idx = (i + l.photos.length) % l.photos.length;
      img.src = l.photos[idx];
      if (cnt) cnt.textContent = (idx + 1) + " / " + l.photos.length;
    };
    if (prev && next) {
      prev.onclick = function (e) { e.stopPropagation(); show(idx - 1); };
      next.onclick = function (e) { e.stopPropagation(); show(idx + 1); };
    }
    // fullscreen gallery on photo tap
    img.style.cursor = "zoom-in";
    img.onclick = function () { openLightbox(l, idx); };
    var more = document.getElementById("desc-more");
    if (more) more.onclick = function () {
      var d = document.getElementById("card-desc");
      var expanded = d.dataset.full === "1";
      d.textContent = expanded ? short : l.desc;
      d.dataset.full = expanded ? "" : "1";
      more.textContent = expanded ? "more" : "less";
    };
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // fullscreen photo gallery (+ scoring report on the back)
  function openLightbox(l, startIdx) {
    closeLightbox();
    var lb = document.createElement("div");
    lb.id = "lightbox";
    lb.innerHTML =
      '<button class="lb-x" id="lb-x">✕</button>' +
      '<div class="lb-tabs"><button id="lb-tab-photos" class="on">📷 Photos</button>' +
      '<button id="lb-tab-report">📋 Report</button></div>' +
      '<div id="lb-body"></div>' +
      '<div class="lb-bar"><span class="lb-addr">' + esc(l.address) + " · " + fmt(l.price) + "</span></div>";
    document.body.appendChild(lb);
    var body = document.getElementById("lb-body");
    var i = startIdx;

    function photoView() {
      body.innerHTML =
        '<button class="lb-btn prev" id="lb-prev">‹</button>' +
        '<img id="lb-img" src="' + l.photos[i] + '" alt="' + esc(l.address) + '">' +
        '<button class="lb-btn next" id="lb-next">›</button>' +
        '<span class="lb-count" id="lb-count">' + (i + 1) + " / " + l.photos.length + "</span>";
      var go = function (d) {
        i = (i + d + l.photos.length) % l.photos.length;
        document.getElementById("lb-img").src = l.photos[i];
        document.getElementById("lb-count").textContent = (i + 1) + " / " + l.photos.length;
      };
      document.getElementById("lb-prev").onclick = function (e) { e.stopPropagation(); go(-1); };
      document.getElementById("lb-next").onclick = function (e) { e.stopPropagation(); go(1); };
      lbKeys.go = go;
    }

    function reportView() {
      body.innerHTML = '<div class="lb-report">' + buildReport(l) + "</div>";
      lbKeys.go = null;
    }

    document.getElementById("lb-tab-photos").onclick = function () {
      this.classList.add("on");
      document.getElementById("lb-tab-report").classList.remove("on");
      photoView();
    };
    document.getElementById("lb-tab-report").onclick = function () {
      this.classList.add("on");
      document.getElementById("lb-tab-photos").classList.remove("on");
      reportView();
    };
    document.getElementById("lb-x").onclick = closeLightbox;
    lb.addEventListener("click", function (e) { if (e.target === lb) closeLightbox(); });
    document.addEventListener("keydown", lbKeys);
    var sx = 0;
    lb.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", function (e) {
      var dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 40 && lbKeys.go) lbKeys.go(dx > 0 ? -1 : 1);
    }, { passive: true });
    photoView();
  }
  function lbKeys(e) {
    if (!document.getElementById("lightbox")) { document.removeEventListener("keydown", lbKeys); return; }
    if (e.key === "Escape") closeLightbox();
    if (lbKeys.go) {
      if (e.key === "ArrowLeft") lbKeys.go(-1);
      if (e.key === "ArrowRight") lbKeys.go(1);
    }
  }
  function closeLightbox() {
    var lb = document.getElementById("lightbox");
    if (lb) lb.remove();
    document.removeEventListener("keydown", lbKeys);
  }

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
      openCard(l);
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
            openCard(l);
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
