/* ═══════════════════════════════════════════════════════════════════════
   PINIT — zajednički modul za karte (MapLibre GL)
   • Radi ODMAH bez ikakvog ključa (besplatne OpenStreetMap pločice).
   • Opcionalno: zalijepi MapTiler ključ dole za ljepše vektorske karte.
   • Centrirano na TEŠANJ, pokriva cijelu BiH (slobodno panovanje/zum).
   Koristi se u app.html, platforma.html i komandni.html — jedan izvor istine.
   ═══════════════════════════════════════════════════════════════════════ */
window.PINIT_MAPS = (function () {
  "use strict";

  /* ⬇⬇⬇  OVDJE (i samo ovdje) zalijepi svoj MapTiler ključ za ljepše karte.
     Ostavi prazno ("") da radi besplatno s OpenStreetMap pločicama.
     Ključ dobiješ na maptiler.com → Account → API Keys (besplatno, bez kartice). */
  var MAPTILER_KEY = "WGivz4IfoLhH0t4fzDA7";

  // Tešanj (pilot grad) + granice BiH
  var TESANJ = { lng: 17.9887, lat: 44.6089, zoom: 13 };
  var BIH_BOUNDS = [[15.6, 42.4], [19.8, 45.4]]; // [JZ, SI] — cijela Bosna i Hercegovina

  var CATCOLOR = {
    putevi: "#f59000", rupe: "#f59000", rupa: "#f59000",
    otpad: "#16a34a", cistoca: "#16a34a", smece: "#16a34a",
    voda: "#0891b2", poplava: "#0891b2", curenje: "#0891b2",
    rasvjeta: "#e24b4a", rasveta: "#e24b4a",
    predmet: "#7c3aed", ostalo: "#7c3aed"
  };
  function color(cat) { return CATCOLOR[String(cat || "ostalo").toLowerCase()] || "#7c3aed"; }

  function style() {
    if (MAPTILER_KEY) {
      return "https://api.maptiler.com/maps/streets-v2/style.json?key=" + MAPTILER_KEY;
    }
    // Keyless: OpenStreetMap raster pločice
    return {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          attribution: "© OpenStreetMap doprinosioci"
        }
      },
      layers: [{ id: "osm", type: "raster", source: "osm" }]
    };
  }

  var map = null, userMarker = null, markers = [];

  function init(elId, opts) {
    opts = opts || {};
    if (typeof maplibregl === "undefined") {
      console.error("MapLibre GL nije učitan — dodaj <script>/<link> sa CDN-a prije maps.js");
      return null;
    }
    var conf = {
      container: elId,
      style: style(),
      center: [opts.lng != null ? opts.lng : TESANJ.lng, opts.lat != null ? opts.lat : TESANJ.lat],
      zoom: opts.zoom != null ? opts.zoom : TESANJ.zoom,
      attributionControl: true
    };
    if (!opts.freeRoam) conf.maxBounds = BIH_BOUNDS; // drži se u granicama BiH osim ako se traži drugačije
    map = new maplibregl.Map(conf);
    if (!opts.noControls) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    }
    return map;
  }

  // Tačka trenutne lokacije korisnika
  function setUser(lat, lng, recenter) {
    if (!map || typeof lat !== "number" || typeof lng !== "number") return;
    if (userMarker) userMarker.remove();
    var el = document.createElement("div");
    el.style.cssText =
      "width:16px;height:16px;border-radius:50%;background:#1c7a35;border:3px solid #fff;" +
      "box-shadow:0 0 0 4px rgba(28,122,53,.25),0 1px 4px rgba(0,0,0,.3)";
    userMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
    if (recenter) map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 14) });
  }

  // Pin jedne prijave: {lat,lng,cat,note,status}
  function addReport(r) {
    if (!map || !r || typeof r.lat !== "number" || typeof r.lng !== "number") return null;
    var el = document.createElement("div");
    el.style.cssText =
      "width:20px;height:20px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);" +
      "background:" + color(r.cat) + ";border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.35);cursor:pointer";
    if (r.status === 3) el.style.opacity = ".55"; // riješeno = blijeđe
    var m = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([r.lng, r.lat]).addTo(map);
    var txt = (r.cat || "") + (r.note ? " — " + r.note : "");
    if (txt.trim()) m.setPopup(new maplibregl.Popup({ offset: 16, closeButton: false }).setText(txt));
    markers.push(m);
    return m;
  }

  // Žarište (crna tačka): {lat,lng,cat,count}
  function addHotspot(h) {
    if (!map || !h || typeof h.lat !== "number" || typeof h.lng !== "number") return null;
    var el = document.createElement("div");
    el.style.cssText =
      "min-width:26px;height:26px;padding:0 6px;border-radius:14px;background:" + color(h.cat) + ";" +
      "color:#fff;font:700 12px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;" +
      "border:2px solid #fff;box-shadow:0 2px 7px rgba(0,0,0,.4)";
    el.textContent = (h.count || 1) + "\u00d7";
    var m = new maplibregl.Marker({ element: el }).setLngLat([h.lng, h.lat]).addTo(map);
    markers.push(m);
    return m;
  }

  function clear() { markers.forEach(function (m) { m.remove(); }); markers = []; }

  // Traži GPS i pomjeri mapu na korisnika
  function locate(recenter) {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      function (p) { setUser(p.coords.latitude, p.coords.longitude, recenter !== false); },
      function () {},
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  return {
    init: init, setUser: setUser, addReport: addReport, addHotspot: addHotspot,
    clear: clear, locate: locate, color: color,
    map: function () { return map; }, TESANJ: TESANJ, BIH_BOUNDS: BIH_BOUNDS,
    usingMapTiler: function () { return !!MAPTILER_KEY; }
  };
})();
