/* ═══════════════════════════════════════════════════
   MAP SETUP
═══════════════════════════════════════════════════ */
const map = L.map('map', {
  center: [34.9275, -82.4401],
  zoom: 16,
  maxBounds: [[34.91, -82.46], [34.94, -82.42]]
});

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  minZoom: 14, maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(map);

/* ═══════════════════════════════════════════════════
   PARKING LOGIC
═══════════════════════════════════════════════════ */
const passNames = { Green: 'South Housing', Yellow: 'Clark Murphy', BabyBlue: 'North Village', Silver: 'Silver/Senior', Orange: 'Commuter/Grad', Purple: 'Faculty/Staff' };
const passColors = { Green: '#00cc00', Yellow: '#ffcc00', BabyBlue: '#00a9f9', Silver: '#808080', Orange: '#ff8c00', Purple: '#9932cc', All: '#FA9BCF' };
const passActiveBg = { Green: '#00cc00', Yellow: '#e6b800', BabyBlue: '#00a9f9', Silver: '#808080', Orange: '#ff8c00', Purple: '#9932cc', All: '#e080b0' };

let parkingData = null;
let activePassVal = null;
const parkingLayerCache = {};

const policeMask = {
  type: "Feature", properties: { name: "Mask" },
  geometry: { type: "Polygon", coordinates: [[[-82.43555, 34.92860], [-82.43555, 34.92838], [-82.43488, 34.92838], [-82.43488, 34.92878], [-82.43555, 34.92860]]] }
};
const maskLayer = L.geoJSON(policeMask, { style: { color: "#FFFFE4", fillColor: "#FFFFE4", fillOpacity: 1, weight: 0 } });

function getParkingLayer(val) {
  if (parkingLayerCache[val]) return parkingLayerCache[val];
  let layer;
  if (val === 'All') {
    layer = L.geoJSON(parkingData, {
      style: { color: '#FA9BCF', weight: 3, opacity: 0.9, fillColor: '#FA9BCF', fillOpacity: 0.35 },
      onEachFeature: (f, l) => l.bindPopup(`<strong>${f.properties.tags?.name || 'Unnamed'}</strong><br>${(f.properties.pass || []).join(', ')}`)
    });
  } else {
    const color = passColors[val];
    layer = L.geoJSON(parkingData, {
      filter: f => Array.isArray(f.properties.pass) ? f.properties.pass.includes(val) : f.properties.pass === val,
      style: () => ({ color, weight: 5, fillColor: color, fillOpacity: 0.5 }),
      onEachFeature: (f, l) => l.bindPopup(`<strong>Lot:</strong> ${f.properties.tags?.name || 'Unnamed'}`)
    });
  }
  parkingLayerCache[val] = layer;
  return layer;
}

function selectPass(val) {
  if (!parkingData) return;
  if (activePassVal === val) {
    activePassVal = null;
    document.querySelectorAll('.pass-btn').forEach(b => { b.classList.remove('active'); b.style.background = ''; });
    Object.values(parkingLayerCache).forEach(l => map.removeLayer(l));
    return;
  }
  activePassVal = val;
  document.querySelectorAll('.pass-btn').forEach(b => {
    b.classList.remove('active');
    b.style.background = '';
    if (b.dataset.val === val) { b.classList.add('active'); b.style.background = passActiveBg[val]; }
  });
  Object.values(parkingLayerCache).forEach(l => map.removeLayer(l));
  getParkingLayer(val).addTo(map);
}

/* ═══════════════════════════════════════════════════
   BUILDING SEARCH LOGIC
═══════════════════════════════════════════════════ */
let buildingData = null;
let buildingLayer = null;
let highlightLayer = null;
let pulseMarker = null;
let buildingIndex = [];

function toArray(val) { return Array.isArray(val) ? val.filter(Boolean) : (val ? String(val).split(',').map(s => s.trim()) : []); }

function buildSearchIndex(geojson) {
  buildingIndex = geojson.features.map(f => ({
    name: f.properties.name || 'Unnamed',
    aka: toArray(f.properties.aka),
    rooms: toArray(f.properties.rooms),
    departments: toArray(f.properties.departments || f.properties.department),
    offices: toArray(f.properties.offices || f.properties.office),
    dining: toArray(f.properties.dining),
    url: f.properties.url || f.properties.website || null,
    feature: f
  }));
}

function flyToBuilding(entry) {
  const center = L.geoJSON(entry.feature).getBounds().getCenter();
  if (highlightLayer) map.removeLayer(highlightLayer);
  if (pulseMarker) map.removeLayer(pulseMarker);
  highlightLayer = L.geoJSON(entry.feature, { style: { color: '#7c3aed', weight: 4, fillColor: '#7c3aed', fillOpacity: 0.28 } }).addTo(map);
  pulseMarker = L.marker(center, { icon: L.divIcon({ className: 'building-pulse-marker', html: '<div></div>', iconSize: [14, 14] }) }).addTo(map);
  map.flyTo(center, 18);
}

// Search Logic
const searchInput = document.getElementById('buildingSearch');
const searchClear = document.getElementById('searchClear');
const dropdown = document.getElementById('buildingDropdown');

searchInput.addEventListener('input', () => {
  const q = searchInput.value.toLowerCase();
  searchClear.style.display = q ? 'block' : 'none';
  const results = buildingIndex.filter(e => e.name.toLowerCase().includes(q)).slice(0, 10);
  dropdown.innerHTML = results.map(e => `<div class="dropdown-item" data-name="${e.name}"><span class="item-name">${e.name}</span></div>`).join('');
  dropdown.style.display = results.length ? 'block' : 'none';
});

dropdown.addEventListener('click', e => {
  const item = e.target.closest('.dropdown-item');
  if (item) {
    const entry = buildingIndex.find(ent => ent.name === item.dataset.name);
    flyToBuilding(entry);
    dropdown.style.display = 'none';
    searchInput.value = entry.name;
  }
});

/* ═══════════════════════════════════════════════════
   MODE SWITCHING
═══════════════════════════════════════════════════ */
function setMode(mode) {
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  document.getElementById('parkingControls').classList.toggle('hidden', mode !== 'parking');
  document.getElementById('buildingControls').classList.toggle('hidden', mode !== 'buildings');
  
  if (mode === 'buildings' && buildingData && !buildingLayer) {
    buildingLayer = L.geoJSON(buildingData, { style: { color: '#5b21b6', weight: 1.5, fillOpacity: 0.2 } }).addTo(map);
  }
}

document.querySelectorAll('.mode-tab').forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

/* ═══════════════════════════════════════════════════
   DATA LOADING
═══════════════════════════════════════════════════ */
Promise.all([
  fetch(PARKING_GEOJSON).then(r => r.json()),
  fetch(BUILDINGS_GEOJSON).then(r => r.json())
]).then(([parking, buildings]) => {
  parkingData = parking;
  buildingData = buildings;
  buildSearchIndex(buildings);
  maskLayer.addTo(map);
});

document.querySelectorAll('.pass-btn').forEach(btn => btn.addEventListener('click', () => selectPass(btn.dataset.val)));