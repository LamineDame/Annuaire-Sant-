// ==============================
// URLS (TES GISTS)
// ==============================

const EPCI_URL =
  "https://gist.githubusercontent.com/LamineDame/e4169b84e8077be6ff8a5553abce2437/raw/f295aeba88206ac9bf9c5d5256b2a7a7a7934b77/epci.geojson";

const MEDECINS_URL =
  "https://gist.githubusercontent.com/LamineDame/c98a034170194601eee37bc7f56d52e0/raw/dfea4c426de848ba60725877ce98740099b52c10/medecins.geojson";

// ⚠️ Mets ici TON GeoJSON de COMMUNES (polygones). Le lien ci-dessous est celui des médecins, donc pas bon pour les communes.
const COMMUNES_URL = "https://gist.githubusercontent.com/LamineDame/42649f567585145707430d230e9354db/raw/62e26791ae036462b57ee826b40f774e20941be4/communes.geojson"; // ex: "https://gist.githubusercontent.com/.../communes.geojson"

// Thème (NE PAS CHANGER)
const COLOR_MAIN = "#ec663a";
const COLOR_DARK = "#b84623";
const ORANGE_1 = "#ffb49a"; // clair
const ORANGE_2 = "#ec663a"; // moyen (couleur demandée)
const ORANGE_3 = "#b84623"; // foncé

// Champs EPCI
const EPCI_CODE_FIELD = "code_epci";
const EPCI_NAME_FIELD = "nom_epci";

// Champs Médecins
const F_CIVILITE = "Civilité";
const F_TEL = "Numéro de téléphone";
const F_NOM = "Nom du professionnel";
const F_ADRESSE = "Adresse";
const F_PROF = "Profession";
const F_COMMUNE = "Commune";

// ==============================
// GLOBALS
// ==============================
let epciData = null;
let medecinsData = null;
let communesData = null;

let choixProfession = "";
let clickedCoordinates = null;
let isOn = false;

// agrégation EPCI
let epciAggFC = null;

// ==============================
// HELPERS
// ==============================
function showLoader() { document.getElementById("loader").style.display = "flex"; }
function hideLoader() { document.getElementById("loader").style.display = "none"; }

function getProp(p, k) {
  if (!p) return "";
  if (p[k] != null && String(p[k]).trim() !== "") return p[k];

  const alt = {
    "Civilité": ["Civilite", "civilite"],
    "Numéro de téléphone": ["Numero_de_telephone", "Numero.de.telephone", "telephone"],
    "Nom du professionnel": ["Nom_du_professionnel", "Nom.du.professionnel", "nom"],
    "Adresse": ["adresse", "Adresse_postale"],
    "Profession": ["profession", "libelle_profession"],
    "Commune": ["commune"],
  };
  const tries = alt[k] || [];
  for (const kk of tries) {
    if (p[kk] != null && String(p[kk]).trim() !== "") return p[kk];
  }
  return "";
}

function removeLayerIfExists(layerId) {
  if (map.getLayer(layerId)) map.removeLayer(layerId);
  if (map.getSource(layerId)) map.removeSource(layerId);
}

function euclideanDistance(coord1, coord2) {
  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;
  return Math.sqrt((lon2 - lon1) ** 2 + (lat2 - lat1) ** 2);
}

function fitToGeoJSON(gj) {
  const bounds = new maplibregl.LngLatBounds();
  const extend = (coords) => {
    if (!coords) return;
    if (typeof coords[0] === "number") bounds.extend(coords);
    else coords.forEach(extend);
  };
  if (gj.type === "FeatureCollection") gj.features.forEach(f => extend(f.geometry?.coordinates));
  else if (gj.type === "Feature") extend(gj.geometry?.coordinates);
  if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 40, duration: 1200 });
}

// ==============================
// MAP
// ==============================
const map = new maplibregl.Map({
  container: "map",
  style: "https://openmaptiles.geo.data.gouv.fr/styles/osm-bright/style.json",
  center: [3.5, 43.68],
  zoom: 9,
  attributionControl: false
});

// Controls
map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }));

// Attribution bas
map.addControl(new maplibregl.AttributionControl({
  compact: true,
  customAttribution:
    "Observatoire territorial du Pays Cœur d’Hérault | Données : Annuaire santé (CPAM) | Fond : OpenMapTiles (© OpenStreetMap)"
}), "bottom-right");

// ==============================
// LOAD DATA
// ==============================
async function loadAllDataOnce() {
  if (epciData && medecinsData) return;

  const [epci, med] = await Promise.all([
    fetch(EPCI_URL).then(r => r.json()),
    fetch(MEDECINS_URL).then(r => r.json())
  ]);

  epciData = epci;
  medecinsData = med;

  // communes (facultatif tant que tu n'as pas l'URL)
  if (COMMUNES_URL && COMMUNES_URL.startsWith("http")) {
    try {
      communesData = await fetch(COMMUNES_URL).then(r => r.json());
    } catch (e) {
      console.warn("COMMUNES_URL invalide ou non accessible.");
      communesData = null;
    }
  }

  // construire l’agrégation EPCI
  epciAggFC = buildEPCIAgg(epciData, medecinsData);

  console.log("EPCI:", epciData.features?.length);
  console.log("Médecins:", medecinsData.features?.length);
  console.log("Agg EPCI points:", epciAggFC.features?.length);
}

// ==============================
// DROPDOWNS (Profession + Commune)
// ==============================
async function populateDropdowns() {
  await loadAllDataOnce();

  const profSet = new Set();
  const comSet = new Set();

  (medecinsData.features || []).forEach(f => {
    const p = f.properties || {};
    const prof = getProp(p, F_PROF);
    const com = getProp(p, F_COMMUNE);
    if (prof) profSet.add(prof);
    if (com) comSet.add(com);
  });

  const profs = [...profSet].sort();
  const comms = [...comSet].sort();

  const selProfNav = document.getElementById("paramChoixProf_naviguer");
  const selComNav = document.getElementById("paramChoixCom_naviguer");
  const selProfIt = document.getElementById("paramChoixProf_itineraire");

  const fill = (sel, list, keepFirst = true) => {
    if (!sel) return;
    sel.length = keepFirst ? 1 : 0;
    list.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    });
  };

  fill(selProfNav, profs);
  fill(selComNav, comms);
  fill(selProfIt, profs);
}

// ==============================
// COMMUNES (contours fins noirs)
// ==============================
function addCommunesLayer() {
  if (!communesData) return;
  if (map.getSource("communes")) return;

  map.addSource("communes", { type: "geojson", data: communesData });

  map.addLayer({
    id: "communes-outline",
    type: "line",
    source: "communes",
    minzoom: 10.5,
    paint: {
      "line-color": "#000000",
      "line-width": 0.25,
      "line-opacity": 0.8
    }
  });
}

// ==============================
// EPCI LAYERS (polygones)
// ==============================
function addEPCILayers() {
  if (map.getSource("epci")) return;

  map.addSource("epci", { type: "geojson", data: epciData });

  map.addLayer({
    id: "epci-fill",
    type: "fill",
    source: "epci",
    minzoom: 8,
    paint: {
      "fill-color": [
        "match",
        ["get", EPCI_CODE_FIELD],
        "243400355", "#FFB46A",
        "243400694", "#D96F0D",
        "200017341", "#F28C28",
        "#F28C28"
      ],
      "fill-opacity": 0
    }
  });

  map.addLayer({
    id: "epci-outline",
    type: "line",
    source: "epci",
    minzoom: 8,
    paint: {
      "line-color": "#D96F0D",
      "line-width": 2,
      "line-opacity": 0.9
    }
  });

  map.addLayer({
    id: "epci-label",
    type: "symbol",
    source: "epci",
    minzoom: 9.5,
    layout: {
      "text-field": ["get", EPCI_NAME_FIELD],
      "text-size": 12,
      "text-anchor": "center"
    },
    paint: {
      "text-color": "#7A3E00",
      "text-halo-color": "#ffffff",
      "text-halo-width": 2
    }
  });

  map.on("mouseenter", "epci-fill", () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", "epci-fill", () => map.getCanvas().style.cursor = "");

  map.on("click", "epci-fill", (e) => {
    const p = e.features[0].properties || {};
    const name = p[EPCI_NAME_FIELD] || "EPCI";
    const code = p[EPCI_CODE_FIELD] || "";

    new maplibregl.Popup({ maxWidth: "360px" })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:system-ui;line-height:1.35">
          <div style="font-weight:900;color:${COLOR_DARK}">${name}</div>
          <div style="color:#666;font-size:12px">Code EPCI : ${code}</div>
        </div>
      `)
      .addTo(map);
  });
}

// ==============================
// 1er NIVEAU : AGG NB MEDECINS PAR EPCI
// ==============================
function buildEPCIAgg(epciFC, medFC) {
  const pts = (medFC.features || []).filter(f => f.geometry && f.geometry.type === "Point");
  const ptsFC = turf.featureCollection(pts);

  const agg = (epciFC.features || []).map(poly => {
    const inside = turf.pointsWithinPolygon(ptsFC, poly);
    const count = inside.features.length;
    const c = turf.centroid(poly);
    c.properties = {
      [EPCI_CODE_FIELD]: poly.properties?.[EPCI_CODE_FIELD],
      [EPCI_NAME_FIELD]: poly.properties?.[EPCI_NAME_FIELD],
      count
    };
    return c;
  });

  return turf.featureCollection(agg);
}

function addEPCIAggLayers() {
  if (map.getSource("epci-agg")) return;

  map.addSource("epci-agg", { type: "geojson", data: epciAggFC });

  // bulles agg (visible zoom bas)
  map.addLayer({
    id: "epci-agg-bubbles",
    type: "circle",
    source: "epci-agg",
    minzoom: 7,
    maxzoom: 10.6,
    paint: {
      "circle-color": ORANGE_2,
      "circle-opacity": 0.85,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["get", "count"],
        0, 10,
        30, 18,
        150, 28,
        400, 38,
        900, 50
      ]
    }
  });

  // chiffres blancs gras
  map.addLayer({
    id: "epci-agg-count",
    type: "symbol",
    source: "epci-agg",
    minzoom: 7,
    maxzoom: 10.6,
    layout: {
      "text-field": ["to-string", ["get", "count"]],
      "text-size": 12,
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"]
    },
    paint: { "text-color": "#ffffff" }
  });

  // clic => zoom sur EPCI
  map.on("click", "epci-agg-bubbles", (e) => {
    const code = e.features[0].properties?.[EPCI_CODE_FIELD];
    const poly = (epciData.features || []).find(f => f.properties?.[EPCI_CODE_FIELD] == code);
    if (!poly) return;

    const bbox = turf.bbox(poly);
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
      padding: { top: 120, left: 560, right: 60, bottom: 60 },
      duration: 900
    });
  });

  map.on("mouseenter", "epci-agg-bubbles", () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", "epci-agg-bubbles", () => map.getCanvas().style.cursor = "");
}

// ==============================
// MEDECINS CLUSTERS + FILTERS
// (dégradé orange 3 classes + chiffres blancs gras)
// ==============================
function ensureMedecinsSourceAndLayers() {
  if (map.getSource("medecins")) return;

  map.addSource("medecins", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterRadius: 50,
    clusterMaxZoom: 13
  });

  // clusters (3 classes orange)
  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "medecins",
    minzoom: 10.6, // n’apparaît qu’après l’agrégation EPCI
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        ORANGE_1, 20,      // clair
         ORANGE_2, 100,     // moyen
       ORANGE_3           // foncé
      ],
      "circle-radius": [
        "step",
        ["get", "point_count"],
        14, 20,
        20, 100,
        28
      ],
      "circle-opacity": 0.9
    }
  });

  // compte : blanc gras
  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "medecins",
    minzoom: 10.6,
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-size": 12,
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"]
    },
    paint: { "text-color": "#ffffff" }
  });

  // points individuels (3 classes selon un pseudo “niveau” constant = foncé)
  map.addLayer({
    id: "unclustered-point",
    type: "circle",
    source: "medecins",
    minzoom: 10.6,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": ORANGE_2,
      "circle-radius": 5,
      "circle-opacity": 0.95,
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff"
    }
  });

  // Zoom cluster
  map.on("click", "clusters", (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
    const clusterId = features[0].properties.cluster_id;
    map.getSource("medecins").getClusterExpansionZoom(clusterId, (err, zoom) => {
      if (err) return;
      map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom + 1 });
    });
  });

  // Popup médecin
map.on("click", "unclustered-point", (e) => {
  const p = e.features?.[0]?.properties || {};

  const tel = getProp(p, F_TEL) || "Non disponible";
  const nom = getProp(p, F_NOM) || "Professionnel";
  const adresse = getProp(p, F_ADRESSE) || "Non disponible";
  const profession = getProp(p, F_PROF) || "Non disponible";

  new maplibregl.Popup({ maxWidth: "520px", closeButton: true })
    .setLngLat(e.lngLat)
    .setHTML(`
      <div class="popup-card">
        <div class="popup-band med-band">
          <div class="popup-title">${nom}</div>
          <div class="popup-close">×</div>
        </div>

        <div class="popup-body">
          <div class="popup-row">
            <div class="popup-label">Profession:</div>
            <div class="popup-value">${profession}</div>
          </div>

          <div class="popup-row">
            <div class="popup-label">Adresse:</div>
            <div class="popup-value">${adresse}</div>
          </div>

          <div class="popup-row">
            <div class="popup-label">Téléphone:</div>
            <div class="popup-value">${tel}</div>
          </div>
        </div>
      </div>
    `)
    .addTo(map);
});

  map.on("mouseenter", "clusters", () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", "clusters", () => map.getCanvas().style.cursor = "");
  map.on("mouseenter", "unclustered-point", () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", "unclustered-point", () => map.getCanvas().style.cursor = "");
}

function applyMedecinsFilterToSource() {
  const profSel = document.getElementById("paramChoixProf_naviguer").value || "";
  const comSel = document.getElementById("paramChoixCom_naviguer").value || "";

  const filtered = {
    type: "FeatureCollection",
    features: (medecinsData.features || []).filter(f => {
      const p = f.properties || {};
      const prof = getProp(p, F_PROF);
      const com = getProp(p, F_COMMUNE);
      const okProf = profSel ? prof === profSel : true;
      const okCom = comSel ? com === comSel : true;
      return okProf && okCom;
    })
  };

  map.getSource("medecins").setData(filtered);

  if (comSel && filtered.features.length) {
    const bbox = turf.bbox(filtered);
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
      padding: { top: 120, left: 560, right: 60, bottom: 60 },
      duration: 900
    });
  }
}

// ==============================
// ITINERAIRE (OSRM) (inchangé)
// ==============================
function addStartPoint(coords) {
  removeLayerIfExists("start-point-layer");
  map.addLayer({
    id: "start-point-layer",
    type: "circle",
    source: { type: "geojson", data: { type: "Feature", geometry: { type: "Point", coordinates: coords } } },
    paint: { "circle-radius": 8, "circle-color": COLOR_MAIN }
  });
}

function handleMapClick(e) {
  clickedCoordinates = [e.lngLat.lng, e.lngLat.lat];
  addStartPoint(clickedCoordinates);
  checkParams();
}

function checkParams() {
  const btn = document.getElementById("executeButton");
  btn.disabled = !(clickedCoordinates && choixProfession && !isOn);
}

function getCandidatesByProfession() {
  return (medecinsData.features || []).filter(f => {
    const p = f.properties || {};
    return getProp(p, F_PROF) === choixProfession;
  });
}

async function calculItinerairePlusProche() {
  showLoader();

  const candidates = getCandidatesByProfession();
  if (!candidates.length || !clickedCoordinates) {
    hideLoader();
    return;
  }

  const top10 = candidates
    .map(point => {
      const p = point.properties || {};
      return {
        nom: getProp(p, F_NOM),
        civilite: getProp(p, F_CIVILITE),
        adresse: getProp(p, F_ADRESSE),
        commune: getProp(p, F_COMMUNE),
        profession: getProp(p, F_PROF),
        tel: getProp(p, F_TEL) || "Non disponible",
        coordinates: point.geometry.coordinates,
        d: euclideanDistance(clickedCoordinates, point.geometry.coordinates)
      };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, 10);

  const routes = await Promise.all(
    top10.map(dest =>
      fetch(`https://router.project-osrm.org/route/v1/driving/${clickedCoordinates.join(",")};${dest.coordinates.join(",")}?overview=full&geometries=geojson`)
        .then(res => res.json())
        .then(routeData => ({ routeData, dest }))
    )
  );

  const best = routes.sort((a, b) => a.routeData.routes[0].duration - b.routeData.routes[0].duration)[0];

  removeLayerIfExists("destination-layer");
  removeLayerIfExists("itineraire-layer");

  map.addLayer({
    id: "destination-layer",
    type: "circle",
    source: { type: "geojson", data: { type: "Feature", geometry: { type: "Point", coordinates: best.dest.coordinates } } },
    paint: { "circle-color": "#e53935", "circle-radius": 8 }
  });

  map.addLayer({
    id: "itineraire-layer",
    type: "line",
    source: { type: "geojson", data: { type: "Feature", geometry: best.routeData.routes[0].geometry } },
    paint: { "line-color": COLOR_MAIN, "line-width": 4 }
  });

  const km = Math.round((best.routeData.routes[0].distance / 1000) * 100) / 100;

  document.getElementById("message_itineraire").innerHTML = `
    <hr>
    <h3>Professionnel le plus proche</h3>
    <p><b>Profession :</b> ${best.dest.profession}</p>
    <p><b>Distance :</b> ${km} km</p>
    <p><b>Nom :</b> ${best.dest.nom}</p>
    <p><b>Commune :</b> ${best.dest.commune}</p>
    <p><b>Adresse :</b> ${best.dest.adresse}</p>
    <p><b>Téléphone :</b> ${best.dest.tel}</p>
  `;

  const bbox = turf.bbox({ type: "Feature", geometry: best.routeData.routes[0].geometry });
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
    padding: { top: 120, left: 560, right: 60, bottom: 60 },
    duration: 1000
  });

  hideLoader();
}

// ==============================
// UI (inchangé)
// ==============================
function show(el) { el.style.display = "block"; }
function hide(el) { el.style.display = "none"; }

const infoFenetre = document.getElementById("info-fenetre");
const fenetreScenario = document.getElementById("fenetre-scenario");
const fenetreNaviguer = document.getElementById("fenetre-naviguer");

document.querySelector(".btn-naviguer").addEventListener("click", async () => {
  const isOpen = fenetreNaviguer.style.display === "block";

  if (isOpen) {
    hide(fenetreNaviguer);
    show(infoFenetre);
  } else {
    hide(fenetreScenario);
    hide(infoFenetre);
    show(fenetreNaviguer);

    ensureMedecinsSourceAndLayers();
    applyMedecinsFilterToSource();
  }
});

document.querySelector(".btn-scenario").addEventListener("click", async () => {
  const isOpen = fenetreScenario.style.display === "block";

  if (isOpen) {
    hide(fenetreScenario);
    show(infoFenetre);
  } else {
    hide(fenetreNaviguer);
    hide(infoFenetre);
    show(fenetreScenario);
  }
});

document.getElementById("paramChoixProf_naviguer").addEventListener("change", () => {
  ensureMedecinsSourceAndLayers();
  applyMedecinsFilterToSource();
});
document.getElementById("paramChoixCom_naviguer").addEventListener("change", () => {
  ensureMedecinsSourceAndLayers();
  applyMedecinsFilterToSource();
});

document.getElementById("btnReset").addEventListener("click", () => {
  document.getElementById("paramChoixProf_naviguer").value = "";
  document.getElementById("paramChoixCom_naviguer").value = "";
  ensureMedecinsSourceAndLayers();
  applyMedecinsFilterToSource();
  fitToGeoJSON(epciData);
});

document.getElementById("paramChoixProf_itineraire").addEventListener("change", (e) => {
  choixProfession = e.target.value;
  checkParams();
});

document.getElementById("toggleButton").addEventListener("click", () => {
  isOn = !isOn;
  const btn = document.getElementById("toggleButton");
  btn.textContent = isOn ? "Récupérer le point" : "Placer un point";

  if (isOn) {
    map.on("click", handleMapClick);
    map.getCanvas().style.cursor = "crosshair";
  } else {
    map.off("click", handleMapClick);
    map.getCanvas().style.cursor = "";
  }
  checkParams();
});

document.getElementById("executeButton").addEventListener("click", async () => {
  await calculItinerairePlusProche();
});

// ==============================
// INIT
// ==============================
map.on("load", async () => {
  await loadAllDataOnce();

  // 1) Polygones EPCI
  addEPCILayers();

  // 2) Agrégation EPCI (zoom bas)
  addEPCIAggLayers();

  // 3) Communes (zoom plus haut)
  addCommunesLayer();

  // 4) Médecins (clusters/points) — visibles après minzoom (10.6)
  ensureMedecinsSourceAndLayers();
  applyMedecinsFilterToSource();

  await populateDropdowns();
  fitToGeoJSON(epciData);
});