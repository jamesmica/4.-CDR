/* ===========================
   Paramètres & constantes
=========================== */
const CONFIG = {
  sheetId: "1FUhix1FToy_joK8lZuiZvZp6aCeQncByDaFVfPGKU1k", // <-- remplace si besoin
  csvPath: "centroides_total.csv",
  sheetGid: "0", 
  regionsPath: "regions-20180101.json",

  // Colonnes (noms exacts de l'en-tête Google Sheets)
  COLS: {
    Date: "Date",                      // Année (AAAA)
    Type: "Type",                      // Type brut / semi-normalisé
    AssociatedCompany: "Associated Company",
    INSEE: "INSEE",
    EPCICOM: "EPCICOM",           // code insee intercommunalité ou commune
    COL: "COL",                        // Couleur (si fournie)
    NomType: "NomType",                // Sous-type / détail
    Region: "Region"
  }
};

/* ===========================
   État global
=========================== */
let map, regionLayer;
let rows = [];           // lignes GSheet (objets {col:value})
let centers = [];        // [{INSEE, lat, lon}]
let activeTypes = new Set(); // types normalisés sélectionnés (chips)
let searchQuery = "";
let selectedRegionLayer = null; // couche région sélectionnée (persistante)
let selectedRegionGeo = null;
let selectedRegionBuffered = null;
let activeGroupLabel = null;          // famille actuellement affichée
let availableCatsByGroup = new Map(); // label -> sous-catégories présentes

// Accès rapide markers/lignes
const markerByRowIdx = new Map();     // rowIndex -> Leaflet marker
const rowIdxsByLatLon = new Map();    // "lat,lon" -> [rowIndex,...]

/* ===========================
   Utils
=========================== */
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const normalize = (s) => (s || "")
  .toString()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .trim();

const debounce = (fn, wait = 160) => {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
};

function tokens(q) {
  return normalize(q).split(/\s+/).filter(Boolean);
}

function setPanelCollapsed(collapsed){
  document.body.classList.toggle('panel-collapsed', collapsed);
  const btn = document.getElementById('panelToggleFloating');
  if (btn) btn.textContent = collapsed ? '⟨' : '⟩';
}


function highlight(str, qTokens) {
  if (!qTokens.length) return (str || "");
  let out = (str || "").toString();
  qTokens.forEach(t => {
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")})`, "ig");
    out = out.replace(re, "<mark>$1</mark>");
  });
  return out;
}

function markerRadius() {
  const z = map?.getZoom?.() ?? 6;
  // Petit scale selon le zoom
  return Math.max(2, Math.min(7, (z - 5) * 0.8));
}

/* ===========================
   Catégorisation
=========================== */

// Palette
const COLORS = {
  "Abonnement - Profils Thématiques": "#1DB5C5",
  "Achat unique - Profils Thématiques": "#70BA7A",
  "Profils Thématiques": "#70BA7A",
  "ABS": "#EE2528",
  "CTG": "#5C368D",
  "Autres Études / Stratégies": "#95235B",
  "Fiche QPV": "#F9B832",
  "Projection effectifs scolaires": "#F9B832",
  "Diagnostic petite enfance/SPPE": "#F38331",
  "Non précisé": "#7F8C8D"
};

const CHIPS_ORDER = [
  "ABS",
  "CTG",
  "Achat unique - Profils Thématiques",
  "Abonnement - Profils Thématiques",
  "Projection effectifs scolaires",
  "Diagnostic petite enfance/SPPE",
  "Autres Études / Stratégies",
  "Fiche QPV"
];

const CHIP_GROUPS = [
  {
    label: "Outils statistiques",
    cats: [
      "Achat unique - Profils Thématiques",
      "Abonnement - Profils Thématiques",
      "Fiche QPV"
    ]
  },
  {
    label: "Diagnostics / Études / Stratégies",
    cats: [
      "ABS",
      "CTG",
      "Diagnostic petite enfance/SPPE",
      "Projection effectifs scolaires",
      "Autres Études / Stratégies"
    ]
  }
];



// Retourne {cat, sub, color}
function categorize(typeRaw, nomTypeRaw) {
  const t = normalize(typeRaw);
  const n = normalize(nomTypeRaw);
  const combined = `${t} ${n}`;

  // Petits helpers pour éviter de répéter les regex
  const hasDiagEtude = /\b(diagnostic|etude)\b/.test(combined);
  const hasPetiteEnfance = /petite[\s\-]*enfance/.test(combined);

  // ABS / CTG (sous-libellé = libellé lisible du NomType/Type)
  if (/\babs\b/.test(t) || /\babs\b/.test(n)) {
    return { cat: "ABS", sub: friendlyTitle(nomTypeRaw || typeRaw), color: COLORS["ABS"] };
  }
  if (/\bctg\b/.test(t) || /\bctg\b/.test(n) || /conseil\s*transition/.test(combined)) {
    return { cat: "CTG", sub: friendlyTitle(nomTypeRaw || typeRaw), color: COLORS["CTG"] };
  }

  // Abonnements / Achats uniques (Profils)
  if (/abonn/.test(t) || /abonn/.test(n)) {
    return {
      cat: "Abonnement - Profils Thématiques",
      sub: subFromProfiles(typeRaw, nomTypeRaw),
      color: COLORS["Abonnement - Profils Thématiques"]
    };
  }
  if (/achat\s*unique/.test(t) || /achat\s*unique/.test(n)) {
    return {
      cat: "Achat unique - Profils Thématiques",
      sub: subFromProfiles(typeRaw, nomTypeRaw),
      color: COLORS["Achat unique - Profils Thématiques"]
    };
  }
  // Profils thématiques génériques -> ranger avec "Achat unique - Profils Thématiques"
  if (/profil/.test(t) || /profil/.test(n)) {
    return {
      cat: "Achat unique - Profils Thématiques",
      sub: subFromProfiles(typeRaw, nomTypeRaw),
      color: COLORS["Achat unique - Profils Thématiques"]
    };
  }

    if (/budget\s*croise/.test(combined)) { // "croisé" devient "croise" après normalize()
    return {
      cat: "Achat unique - Profils Thématiques",
      sub: "Budget croisé",
      color: COLORS["Achat unique - Profils Thématiques"]
    };
  }

  // Diagnostics & Projections
  // 👉 Désormais SEULEMENT les diagnostics/études qui parlent de petite enfance
  if (hasDiagEtude && hasPetiteEnfance) {
    return {
      cat: "Diagnostic petite enfance/SPPE",
      sub: friendlyTitle(nomTypeRaw || typeRaw),
      color: COLORS["Diagnostic petite enfance/SPPE"]
    };
  }

  if (/projection.*effectifs.*scolaires/.test(combined)) {
    return {
      cat: "Projection effectifs scolaires",
      sub: "Projection effectifs scolaires",
      color: COLORS["Projection effectifs scolaires"]
    };
  }

  // Outils
  if (/fich(e|es)\s*QPV/.test(t) || /fich(e|es)\s*qpv/.test(n)) {
    return {
      cat: "Fiche QPV",
      sub: friendlyTitle(nomTypeRaw || typeRaw),
      color: COLORS["Fiche QPV"]
    };
  }

  // Autres missions
  if (/autre\s*mission/.test(t) || /autre\s*mission/.test(n)) {
    const sub = /projection.*effectifs.*scolaires/.test(combined)
      ? "Projection effectifs scolaires"
      : friendlyTitle(nomTypeRaw || typeRaw);
    const color = sub === "Projection effectifs scolaires"
      ? COLORS["Projection effectifs scolaires"]
      : COLORS["Autres Études / Stratégies"];
    return { cat: "Autres Études / Stratégies", sub, color };
  }

  // Défaut : tout ce qui n’est pas explicitement géré ci-dessus
  return {
    cat: "Autres Études / Stratégies",
    sub: friendlyTitle(nomTypeRaw || typeRaw) || "Non précisé",
    color: COLORS["Autres Études / Stratégies"]
  };
}


function subFromProfiles(typeRaw, nomTypeRaw) {
  const s = normalize((nomTypeRaw || "") + " " + (typeRaw || ""));
  const domains = [
    ["Finances locales", /(finances?\s*locales?)/],
    ["Logement", /\blogement\b/],
    ["Jeunesse", /\bjeun(es|esse)\b/],
    ["Petite enfance", /(petite\s*enfance)/],
    ["Seniors", /\bseniors?\b/],
    ["Santé-handicap", /(sant(e|é).?handicap)/],
    ["Sports", /\bsports?\b/],
    ["Économie-emploi", /(economie.?emploi|économie.?emploi)/],
    ["Vie locale", /(vie\s*locale)/],
    ["Quartier/QPV", /(quartier|qpv)/],
    ["Revenus-précarité", /(revenus|precarit(e|é))/],
  ];

  const found = domains.filter(([_, re]) => re.test(s)).map(([label]) => label);
  if (/petite\s*analyse/.test(s)) found.push("Profil + petite analyse");
  if (/projection.*effectifs.*scolaires/.test(s)) found.push("Projection effectifs scolaires");

  if (!found.length) return friendlyTitle(nomTypeRaw || typeRaw) || "Profil thématique";
  return found.join(" • ");
}

function friendlyTitle(val) {
  if (!val) return "";
  return String(val).split(";").map(s => s.trim()).filter(Boolean).join(" • ");
}


/* ===========================
   Rendu UI
=========================== */

function setActiveGroupTab(groupLabel, { apply = true } = {}) {
  if (!availableCatsByGroup.size) return;

  if (groupLabel && !availableCatsByGroup.has(groupLabel)) {
    groupLabel = Array.from(availableCatsByGroup.keys())[0];
  }

  activeGroupLabel = groupLabel;

  // si groupLabel == null → aucune chip-main active
  $$("#chipsTypes .chip-main").forEach(btn => {
    btn.classList.toggle("active", groupLabel && btn.dataset.group === groupLabel);
  });

  const subRow = $("#chipsSubRow");
  if (!subRow) return;

  subRow.innerHTML = "";
  activeTypes.clear();

  if (!groupLabel) {
    // aucun groupe → pas de sous-chips, pas de filtre type
    if (apply) applyFilters();
    return;
  }

  const cats = availableCatsByGroup.get(groupLabel) || [];
  cats.forEach(cat => {
    activeTypes.add(cat);

    const sub = document.createElement("button");
    sub.className = "chip chip-sub active";
    sub.dataset.value = cat;
    sub.textContent = cat;
    sub.style.setProperty("--chip-color", COLORS[cat] || "#00753B");

    sub.addEventListener("click", () => setActiveSubCategory(cat));

    subRow.appendChild(sub);
  });

  if (apply) applyFilters();
}



function setActiveSubCategory(cat) {
  // un seul sous-type actif
  activeTypes.clear();
  activeTypes.add(cat);

  // activer le bon gros bouton
  const parentGroup = CHIP_GROUPS.find(g => g.cats.includes(cat));
  if (parentGroup) {
    activeGroupLabel = parentGroup.label;
    $$("#chipsTypes .chip-main").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.group === activeGroupLabel);
    });
  }

  // état visuel des sous-chips
  $$("#chipsSubRow .chip-sub").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.value === cat);
  });

  applyFilters();
}


function renderChips(allCats) {
  const container = $("#chipsTypes");
  container.innerHTML = "";
  activeTypes.clear();
  availableCatsByGroup.clear();

  // --- barre des 2 grandes familles ---
  const mainBar = document.createElement("div");
  mainBar.className = "chip-mainbar";

  CHIP_GROUPS.forEach(group => {
    const presentCats = group.cats.filter(cat => allCats.has(cat));
    if (!presentCats.length) return;

    availableCatsByGroup.set(group.label, presentCats);

    const btn = document.createElement("button");
    btn.className = "chip-main";
    btn.textContent = group.label;
    btn.dataset.group = group.label;

    // 🔁 Toggle : clic = active / désactive
    btn.addEventListener("click", () => {
      if (activeGroupLabel === group.label) {
        // 👉 le groupe était actif → on le désactive
        activeGroupLabel = null;
        activeTypes.clear();

        // visuel : plus aucune chip-main active
        $$("#chipsTypes .chip-main").forEach(b => b.classList.remove("active"));

        // on vide les sous-chips
        const subRow = $("#chipsSubRow");
        if (subRow) subRow.innerHTML = "";

        // plus de filtre de type → on voit tout
        applyFilters();
      } else {
        // 👉 on active ce groupe normalement
        setActiveGroupTab(group.label, { apply: true });
      }
    });

    mainBar.appendChild(btn);
  });

  container.appendChild(mainBar);

  // --- ligne pour les sous-catégories de la famille active ---
  const subRow = document.createElement("div");
  subRow.id = "chipsSubRow";
  subRow.className = "chip-subrow";
  container.appendChild(subRow);

  // 🌟 ÉTAT INITIAL : aucun groupe sélectionné, pas de filtre de type
  activeGroupLabel = null;
  activeTypes.clear();
  applyFilters();
}




function renderTable(filtered, qTokens) {
  const body = $("#resultsBody");
  body.innerHTML = "";

  if (!filtered.length) {
    $("#emptyState").classList.remove("hidden");
    return;
  }
  $("#emptyState").classList.add("hidden");

  const frag = document.createDocumentFragment();

  filtered.forEach((r) => {
    const tr = document.createElement("tr");
    tr.dataset.idx = r.__rowIndex;

    const ac = document.createElement("td");
    const tp = document.createElement("td");
    const dt = document.createElement("td");

    const territoryName = highlight(r[CONFIG.COLS.AssociatedCompany], qTokens);
    const inseeCode = r[CONFIG.COLS.EPCICOM] || r[CONFIG.COLS.INSEE] || "";
    const inseeHtml = inseeCode
      ? `<div class="territory-meta">${highlight(inseeCode, qTokens)}</div>`
      : "";

    ac.innerHTML = `${territoryName}${inseeHtml}`;

    tp.innerHTML = `<div class="type-pill" style="--pill-color:${r.__color}">${highlight(r.__sub || "", qTokens)}</div>`;
    dt.innerHTML = highlight(r[CONFIG.COLS.Date], qTokens);

    tr.appendChild(ac); tr.appendChild(tp); tr.appendChild(dt);
    tr.addEventListener("click", () => focusRowOnMap(r.__rowIndex));
    frag.appendChild(tr);
  });

  body.appendChild(frag);
}

/* ===========================
   Carte
=========================== */
function initMap() {
  map = L.map("map", { zoomControl: false }).setView([47.331144447240085, 5.091141071179042], 6);

  // Fond OSM France (comme avant)
  L.tileLayer("//{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
    attribution: 'données © <a href="//osm.org/copyright">OpenStreetMap</a>/ODbL – rendu <a href="//openstreetmap.fr">OSM France</a>'
  }).addTo(map);

  L.control.zoom({ position: "bottomleft" }).addTo(map);

  // Ajuster le rayon des markers au changement de zoom
map.on('zoomend', () => {
  const base = markerRadius();
  markerByRowIdx.forEach(m => {
    const cls = m.options.className || '';
    if (cls.includes('match')) {
      m.setRadius(base + 2);
    } else if (cls.includes('dim')) {
      // même règle que rebuildMarkers (très petit)
      m.setRadius(Math.max(0.6, base * 0.25));
    } else {
      m.setRadius(base);
    }
  });
});

}

function drawRegions(geojson) {
  regionLayer = L.geoJSON(geojson, {
    style: () => ({ color: "#0E7C3A", weight: 1, fillColor: "transparent", fillOpacity: 0 }),
    onEachFeature: (feature, layer) => {
layer.on("click", () => {
  selectedRegionLayer = layer;
  selectedRegionGeo   = layer.toGeoJSON();

  if (window.turf) {
    selectedRegionBuffered = turf.buffer(selectedRegionGeo, 10, { units: "kilometers" });
  }

  regionLayer.resetStyle();
  layer.setStyle({ weight: 3 });

  $("#scopeLabel").textContent = layer.feature?.properties?.nom || "France";
  applyFilters();
});




      layer.on("mouseover", () => {
        if (layer === selectedRegionLayer) return; // ne pas écraser la sélection
        layer.setStyle({ weight: 3});
      });

      layer.on("mouseout", () => {
        if (layer === selectedRegionLayer) return; // ne pas reset la sélection
        regionLayer.resetStyle(layer);
      });
    }
  }).addTo(map);
}

function resetRegion(){
  selectedRegionLayer = null;
  selectedRegionGeo = null;
  selectedRegionBuffered = null;
  if (regionLayer) regionLayer.resetStyle();
}



function getCentroidForRow(row) {
  const code = String(row[CONFIG.COLS.INSEE] || "").trim();
  if (!code) return null;
  // UNIQUEMENT depuis le CSV chargé
  return centers.find(x => x.INSEE === code) || null;
}

/* ===========================
   Markers & interactions
=========================== */
function buildGroupedTooltip(rowsAtPoint){
  const sep = '<div class="tooltip-sep" aria-hidden="true"></div>';
  return rowsAtPoint.map(r => {
    const title = `<strong>${escapeHtml(r[CONFIG.COLS.AssociatedCompany])}</strong>`;
    const sub   = escapeHtml(r.__sub || r[CONFIG.COLS.NomType] || r[CONFIG.COLS.Type] || "");
    const date  = escapeHtml(r[CONFIG.COLS.Date] || "");
    return `${title}<br>${sub}${date ? `<br>${date}` : ""}`;
  }).join(sep);
}


// 'shrink' = très petit et pâle
// 'ghost'  = taille normale mais quasi invisible + non interactif
// 'hide'   = complètement supprimé de la carte quand une recherche est active
const NON_MATCH_MODE = 'ghost'; // 'shrink' | 'ghost' | 'hide'

function rebuildMarkers(rowsInScope, qTokens) {
  // 1) Nettoyage
  map.eachLayer(layer => { if (layer instanceof L.CircleMarker) map.removeLayer(layer); });
  markerByRowIdx.clear();
  rowIdxsByLatLon.clear();

  // 2) Grouper par coordonnée
  const groups = new Map(); // "lat,lon" -> {lat, lon, rows:[]}
  for (const r of rowsInScope) {
    const c = getCentroidForRow(r);
    if (!c) continue;
    const key = `${c.lat},${c.lon}`;
    if (!groups.has(key)) groups.set(key, { lat: c.lat, lon: c.lon, rows: [] });
    groups.get(key).rows.push(r);
  }

  // 3) Créer 1 marker par groupe
  groups.forEach(({ lat, lon, rows: rowsAtPoint }, key) => {
    const hasQuery = qTokens.length > 0;
    const anyMatch = hasQuery ? rowsAtPoint.some(r => matchesSearch(r, qTokens)) : true;

    // Comportement pour les non-matchs
    if (hasQuery && !anyMatch && NON_MATCH_MODE === 'hide') {
      // Ne pas créer de marker du tout
      return;
    }

    // Style
    const base = markerRadius();
    let radius, fillOpacity, strokeOpacity, interactive = true, cls = '';

    if (!hasQuery || anyMatch) {
      radius = base + 2;
      fillOpacity = 0.95;
      strokeOpacity = 1;
      cls = 'match';
    } else if (NON_MATCH_MODE === 'ghost') {
      radius = 0.2;                 // taille normale
      fillOpacity = 0.04;            // quasi invisible
      strokeOpacity = 0.1;
      interactive = false;           // pas de hover/clic
      cls = 'dim ghost';
    } else { // 'shrink' par défaut
      radius = Math.max(0.6, base * 0.25); // très petit
      fillOpacity = 0.15;
      strokeOpacity = 0.2;
      cls = 'dim';
    }

    const color = rowsAtPoint[0].__color;
    const marker = L.circleMarker([lat, lon], {
      radius,
      color,
      fillColor: color,
      fillOpacity,
      opacity: strokeOpacity,
      className: cls,
      interactive
    }).addTo(map);

    // Tooltip fusionné (séparé par un hr léger)
marker.bindTooltip(buildGroupedTooltip(rowsAtPoint), {
  direction: 'auto',
  sticky: true,
  className: 'ithea'   // <-- correspond au CSS .leaflet-tooltip.ithea
});


    // Clic : focus table (si interactif)
    if (interactive) {
      marker.on('click', () => {
        const firstIdx = rowsAtPoint[0].__rowIndex;
        focusRowInTable(firstIdx);
        rowsAtPoint.forEach(r => {
          const tr = document.querySelector(`tr[data-idx="${r.__rowIndex}"]`);
          if (tr) { tr.classList.add('row-focus'); setTimeout(() => tr.classList.remove('row-focus'), 900); }
        });
      });

      // Survol : surlignage de la région (optionnel)
      let hoverRegionLayer = null;
      marker.on('mouseover', () => {
        if (!regionLayer) return;
        try {
          const layers = leafletPip.pointInLayer(marker.getLatLng(), regionLayer, true);
          if (layers && layers.length) {
            hoverRegionLayer = layers[0];
            if (hoverRegionLayer !== selectedRegionLayer) {
              hoverRegionLayer.setStyle({ weight: 3, fillOpacity: 0.05, color: '#0E7C3A' });
            }
          }
        } catch (_) {}
      });
      marker.on('mouseout', () => {
        if (hoverRegionLayer && hoverRegionLayer !== selectedRegionLayer) regionLayer.resetStyle(hoverRegionLayer);
        hoverRegionLayer = null;
      });
    }

    // Index : tous les rowIndex du groupe pointent vers CE marker
    rowsAtPoint.forEach(r => markerByRowIdx.set(r.__rowIndex, marker));
    rowIdxsByLatLon.set(key, rowsAtPoint.map(r => r.__rowIndex));
  });
}


function focusRowOnMap(rowIndex) {
  const m = markerByRowIdx.get(rowIndex);
  if (!m) return;
  map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 9), { duration: 0.5 });
  m.openTooltip();
}

function focusRowInTable(rowIndex) {
  const tr = document.querySelector(`tr[data-idx="${rowIndex}"]`);
  const container = document.getElementById('tableWrap'); // le conteneur scrollable de la table
  if (!tr || !container) return;

  tr.classList.add("row-focus");

  // Calcule la position de la ligne dans le conteneur et centre-la
  const cRect = container.getBoundingClientRect();
  const rRect = tr.getBoundingClientRect();
  const delta = rRect.top - cRect.top; // distance visible entre la ligne et le haut du container
  const targetTop = container.scrollTop + delta - (container.clientHeight / 2 - tr.clientHeight / 2);

  // Scroll "smooth" du container (et surtout pas de la fenêtre/parent)
  if (typeof container.scrollTo === "function") {
    container.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  } else {
    container.scrollTop = Math.max(0, targetTop);
  }

  setTimeout(() => tr.classList.remove("row-focus"), 900);
}


/* ===========================
   Filtres & recherche
=========================== */
function matchesType(r) {
  // 👉 S'il n'y a AUCUN type actif, on ne filtre pas sur le type
  if (!activeTypes.size) return true;
  return activeTypes.has(r.__cat);
}


function isRowInsideSelectedRegion(row){
  if (!selectedRegionLayer) return true;
  if (!selectedRegionBuffered) return false;

  const c = getCentroidForRow(row);
  if (!c) return false;

  const pt = turf.point([c.lon, c.lat]);
  return turf.booleanPointInPolygon(pt, selectedRegionBuffered);
}





function matchesRegion(r) {
  return isRowInsideSelectedRegion(r);
}

function matchesSearch(r, qTokens) {
  if (!qTokens.length) return true;
  const hay = normalize([
    r[CONFIG.COLS.AssociatedCompany],
    r[CONFIG.COLS.NomType],
    r[CONFIG.COLS.Type],
    r[CONFIG.COLS.Region],
    r[CONFIG.COLS.EPCICOM],   // <--- AJOUT
    r[CONFIG.COLS.Date]
  ].join(" "));
  return qTokens.every(tok => hay.includes(tok));
}

function applyFilters() {
  const qTokens = tokens(searchQuery);

  // 1) Portée = types actifs + inclusion géo
  const scopeRows = rows.filter(r => matchesType(r) && matchesRegion(r));

  // 2) Résultats = portée + recherche
  const resultRows = scopeRows.filter(r => matchesSearch(r, qTokens));

  // 3) Libellés & compteurs
  const scopeName = selectedRegionLayer?.feature?.properties?.nom || "France";
  $("#scopeLabel").textContent = scopeName;
  $("#visibleCount").textContent = String(resultRows.length);

  // 4) Rendus
  renderTable(resultRows, qTokens);
  rebuildMarkers(scopeRows, qTokens); // la carte montre la portée ; emphasis sur matchs recherche

  // 5) Logs utiles
  const missingAll = rows.filter(r => !getCentroidForRow(r));
  const missingScope = scopeRows.filter(r => !getCentroidForRow(r));

//   console.groupCollapsed("[DEBUG] Géolocalisation & filtres");
//   console.log("Total lignes (GSheet):", rows.length);
//   console.log("Types actifs:", Array.from(activeTypes));
//   console.log("Région sélectionnée:", scopeName);
//   console.log("Dans la portée (type + région):", scopeRows.length);
//   console.log("Résultats après recherche:", resultRows.length);

//   console.log("— Points non géolocalisés (TOUS):", missingAll.length);
//   if (missingAll.length) {
//     console.table(missingAll.map(r => ({
//       AssociatedCompany: r[CONFIG.COLS.AssociatedCompany],
//       INSEE: r[CONFIG.COLS.INSEE],
//       Type: r[CONFIG.COLS.Type],
//       NomType: r[CONFIG.COLS.NomType],
//       Date: r[CONFIG.COLS.Date]
//     })));
//   }

//   console.log("— Points non géolocalisés (DANS LA PORTÉE):", missingScope.length);
//   if (missingScope.length) {
//     console.table(missingScope.map(r => ({
//       AssociatedCompany: r[CONFIG.COLS.AssociatedCompany],
//       INSEE: r[CONFIG.COLS.INSEE],
//       Type: r[CONFIG.COLS.Type],
//       NomType: r[CONFIG.COLS.NomType],
//       Date: r[CONFIG.COLS.Date]
//     })));
//   }
//   console.groupEnd();
}

/* ===========================
   Données
=========================== */
async function fetchSheet() {
  // URL "Publier sur le Web" (CSV) – pas besoin de clé d'API
  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/pub?gid=${CONFIG.sheetGid}&single=true&output=csv`;

  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      header: true,
      skipEmptyLines: true,
      download: true,
      complete: (res) => {
        // res.data = [{Date:"...", Type:"...", ...}, ...] avec les entêtes exactes
        const rowsObj = res.data.map((obj, idx) => ({ ...obj, __rowIndex: idx }));
        // Tri décroissant par Date (si c'est une année AAAA)
        rowsObj.sort((a, b) => Number(b[CONFIG.COLS.Date]) - Number(a[CONFIG.COLS.Date]));
        resolve(rowsObj);
      },
      error: reject
    });
  });
}


function fetchCSV(path) {
  return new Promise((resolve, reject) => {
    Papa.parse(path, {
      header: true,
      skipEmptyLines: true,
      download: true,
      complete: (res) => {
        const cleaned = res.data.map(r => ({
          INSEE: String(r["INSEE"] || "").trim(),
          lat: parseFloat(r["lat"]),
          lon: parseFloat(r["lon"])
        })).filter(x => !isNaN(x.lat) && !isNaN(x.lon) && x.INSEE);
        resolve(cleaned);
      },
      error: (err) => reject(err)
    });
  });
}

/* ===========================
   Bootstrap
=========================== */
async function init() {
  $("#loader").classList.remove("hidden");

  initMap();
  const [geojson, centersData, sheetRows] = await Promise.all([
    fetch(CONFIG.regionsPath).then(r => r.json()),
    fetchCSV(CONFIG.csvPath),
    fetchSheet()
  ]);

  drawRegions(geojson);
  centers = centersData;

  // Catégoriser & coloriser
  const categoriesSet = new Set();
rows = sheetRows.map(r => {
  const { cat, sub, color } = categorize(r[CONFIG.COLS.Type], r[CONFIG.COLS.NomType]);
  r.__cat = cat;
  r.__sub = sub;

  // On ne laisse PAS la colonne COL surcharger ABS/CTG
  const colFromSheet = String(r[CONFIG.COLS.COL] || "");
  const isValidHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(colFromSheet);

  if (cat === "ABS" || cat === "CTG") {
    r.__color = COLORS[cat]; // verrouille rouge ABS / bleu CTG
  } else {
    r.__color = isValidHex ? colFromSheet : (color || "#00753B");
  }

  categoriesSet.add(cat);
  return r;
});


  // UI chips
  renderChips(categoriesSet);

  // Premier rendu
  applyFilters();

// === Bouton flottant (après que le DOM et la carte soient prêts) ===
setPanelCollapsed(false); // état initial: panneau ouvert + flèche ⟩

const floatBtn = document.getElementById('panelToggleFloating');
if (floatBtn){
  floatBtn.addEventListener('click', () => {
    const collapsed = document.body.classList.contains('panel-collapsed');
    setPanelCollapsed(!collapsed);
  });
}

  // Réinitialiser
$("#resetFilters").addEventListener("click", () => {
  // 🔄 reset recherche & région
  $("#globalSearch").value = "";
  searchQuery = "";
  resetRegion();

  // ❌ aucun chip-main actif
  activeGroupLabel = null;
  activeTypes.clear();
  $$("#chipsTypes .chip-main").forEach(btn => btn.classList.remove("active"));

  const subRow = $("#chipsSubRow");
  if (subRow) subRow.innerHTML = "";

  // plus de filtre de type → on voit toutes les références
  applyFilters();
});




  // Recherche
  const onSearch = debounce(() => {
    searchQuery = $("#globalSearch").value || "";
    applyFilters();
  }, 180);
  $("#globalSearch").addEventListener("input", onSearch);

  $("#loader").classList.add("hidden");
}

// Échappement simple (tooltip)
function escapeHtml(s) {
  return (s || "").toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

document.addEventListener("DOMContentLoaded", init);
