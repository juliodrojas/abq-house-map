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
    var flagHtml = l.flags.length
      ? '<div class="flags">⚠ ' + l.flags.join(" · ").toUpperCase() + (l.approx ? " · PIN APPROXIMATE" : "") + "</div>"
      : (l.approx ? '<div class="flags">⚠ PIN APPROXIMATE</div>' : "");
    card.innerHTML =
      '<button class="close-x" id="card-x">✕</button>' +
      '<div class="photo">' + (l.flags.indexOf("condo") >= 0 ? "🏢" : "🏠") + "</div>" +
      '<div class="body"><div class="price">' + fmt(l.price) + "</div>" +
      "<h2>" + esc(l.address) + "</h2>" +
      '<div class="meta">' + l.beds_baths + " bd/ba · " + l.sqft.toLocaleString() +
      " sqft · " + l.zip + "<br>" + esc(l.cluster) + "</div>" +
      '<div class="scores">' +
      '<div class="score"><b>' + l.v1 + '</b>amenity</div>' +
      '<div class="score"><b>' + l.v2 + '</b>trend</div>' +
      '<div class="score"><b>' + l.v3 + '</b>safety</div>' +
      '<div class="score"><b>' + l.total + '</b>total</div></div>' +
      flagHtml +
      '<div class="actions"><a target="_blank" rel="noopener" href="https://www.nmwelcomehome.com/Three-Bedroom-Homes-For-Sale-In-Albuquerque-NM-Search-3-Bedrooms-Houses-For-Sale/200000-300000/">View listings</a></div></div>';
    card.classList.remove("hidden");
    document.getElementById("card-x").onclick = function () { card.classList.add("hidden"); };
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

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
      state.data = listings; state.stores = stores;
      wire();
      map.on("load", addDataLayers);
      if (map.loaded()) addDataLayers();
    });
  }).catch(function (err) {
    document.getElementById("map").innerHTML =
      '<div style="padding:40px;font-family:sans-serif">Could not load map data. ' + esc(err.message) + "</div>";
  });
})();
