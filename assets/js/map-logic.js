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
   PARKING DATA & HELPERS
═══════════════════════════════════════════════════ */
const passNames = {
  Green:    'South Housing (Green)',
  Yellow:   'Clark Murphy Complex (Yellow)',
  BabyBlue: 'North Village/Bell Tower (Baby Blue)',
  Silver:   'Silver/Senior (Silver)',
  Orange:   'Commuter/Graduate/OLLI (Orange)',
  Purple:   'Faculty/Staff (Purple)'
};

const passColors = {
  Green: '#00cc00', Yellow: '#ffcc00', BabyBlue: '#00a9f9',
  Silver: '#808080', Orange: '#ff8c00', Purple: '#9932cc', All: '#FA9BCF'
};

const passActiveBg = {
  Green: '#00cc00', Yellow: '#e6b800', BabyBlue: '#00a9f9',
  Silver: '#808080', Orange: '#ff8c00', Purple: '#9932cc', All: '#e080b0'
};

let parkingData = null;
let activePassVal = null;
const parkingLayerCache = {};

const policeMask = {
  type: "Feature", properties: { name: "Mask" },
  geometry: {
    type: "Polygon",
    coordinates: [[
      [-82.43555, 34.92860], [-82.43555, 34.92838], [-82.43488, 34.92838],
      [-82.43488, 34.92878], [-82.43555, 34.92860]
    ]]
  }
};

const maskLayer = L.geoJSON(policeMask, {
  style: { color: "#FFFFE4", fillColor: "#FFFFE4", fillOpacity: 1, weight: 0 }
});

function getParkingLayer(val) {
  if (parkingLayerCache[val]) return parkingLayerCache[val];
  let layer;

  if (val === '_base') {
    layer = L.geoJSON(parkingData, {
      style: { color: "#3388ff", weight: 2, fillColor: "#3388ff", fillOpacity: 0.2 },
      onEachFeature: (f, l) => {
        const tags = f.properties.tags || {};
        let popup = '';
        if (tags.name)     popup += `Name: ${tags.name}<br>`;
        if (tags.capacity) popup += `Spots: ${tags.capacity}<br>`;
        if (popup) l.bindPopup(popup);
      }
    });
  } else if (val === 'All') {
    layer = L.geoJSON(parkingData, {
      style: { color: '#FA9BCF', weight: 3, opacity: 0.9, fillColor: '#FA9BCF', fillOpacity: 0.35 },
      onEachFeature: (f, l) => {
        const passes  = f.properties.pass || [];
        const allowed = passes.map(p => passNames[p] || p).join(', ') || 'None';
        const name    = f.properties.tags?.name || f.properties['@id'] || 'Unnamed';
        l.bindPopup(`<strong>${name}</strong><br>${allowed}`);
      }
    });
  } else {
    const color = passColors[val];
    layer = L.geoJSON(parkingData, {
      filter: f => {
        const passes = f.properties.pass;
        return Array.isArray(passes) ? passes.includes(val) : passes === val;
      },
      style: () => ({ color, weight: 5, opacity: 1, fillColor: color, fillOpacity: 0.5 }),
      onEachFeature: (f, l) => {
        const name = f.properties.tags?.name || f.properties['@id'] || 'Unnamed';
        l.bindPopup(`<strong>Allowed for:</strong> ${passNames[val]}<br><strong>Lot:</strong> ${name}`);
      }
    });
  }

  parkingLayerCache[val] = layer;
  return layer;
}

function showParkingLayer(val) {
  Object.values(parkingLayerCache).forEach(l => { if (map.hasLayer(l)) l.remove(); });
  if (map.hasLayer(maskLayer)) maskLayer.remove();
  if (val) {
    const layer = getParkingLayer(val);
    layer.addTo(map);
    if (val !== '_base' && layer.getLayers().length) map.fitBounds(layer.getBounds());
  }
  maskLayer.addTo(map);
}

function selectPass(val) {
  if (!parkingData) return;
  if (activePassVal === val) {
    activePassVal = null;
    document.querySelectorAll('.pass-btn').forEach(b => {
      b.classList.remove('active');
      b.style.background = '';
      b.style.borderColor = '';
    });
    showParkingLayer(null);
    return;
  }
  activePassVal = val;
  document.querySelectorAll('.pass-btn').forEach(b => {
    b.classList.remove('active');
    b.style.background = '';
    b.style.borderColor = 'transparent';
  });
  const btn = document.querySelector(`.pass-btn[data-val="${val}"]`);
  if (btn) {
    btn.classList.add('active');
    btn.style.background  = passActiveBg[val];
    btn.style.borderColor = passActiveBg[val];
  }
  showParkingLayer(val);
}

/* ═══════════════════════════════════════════════════
   BUILDING DATA & SEARCH
═══════════════════════════════════════════════════ */
let buildingData  = null;
let buildingLayer = null;
let highlightLayer = null;
let pulseMarker   = null;
let buildingIndex = [];

function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  return String(val).split(',').map(s => s.trim()).filter(Boolean);
}

function buildSearchIndex(geojson) {
  buildingIndex = geojson.features.map(f => {
    const p = f.properties || {};
    return {
      name:        p.name || p['@id'] || 'Unnamed',
      aka:         toArray(p.aka),
      rooms:       toArray(p.rooms),
      departments: toArray(p.departments || p.department),
      offices:     toArray(p.offices     || p.office),
      dining:      toArray(p.dining      || (p.amenity === 'cafe' ? p.name : null)),
      url:         p.url || p.website || null,
      feature: f
    };
  });
}

function getFeatureCenter(feature) {
  const layer = L.geoJSON(feature);
  return layer.getBounds().getCenter();
}

function buildingPopupHtml(entry) {
  const p    = entry.feature.properties || {};
  const addr = p['addr:street']
    ? `${p['addr:housenumber'] || ''} ${p['addr:street']}`.trim()
    : null;

  const uniqueRooms = [...new Set(
    entry.rooms.map(r => r.includes(',') ? r.split(',')[0].trim() : r.trim())
  )].filter(Boolean);

  let html = `<strong>${entry.name}</strong>`;
  if (entry.aka.length) html += `<br><span style="color:#7c3aed;font-size:0.74rem">Also known as: ${entry.aka.join(' · ')}</span>`;
  if (addr) html += `<br><span style="color:#888;font-size:0.76rem">${addr}</span>`;

  if (entry.departments.length) {
    html += `<div class="popup-section"><div class="popup-section-label">🎓 Departments</div><ul class="room-list" style="list-style:none;padding:0">
        ${entry.departments.map(d => `<li>• ${d}</li>`).join('')}</ul></div>`;
  }
  if (entry.offices.length) {
    html += `<div class="popup-section"><div class="popup-section-label">🏢 Offices</div><ul class="room-list" style="list-style:none;padding:0">
        ${entry.offices.map(o => `<li>• ${o}</li>`).join('')}</ul></div>`;
  }
  if (entry.dining.length) {
    html += `<div class="popup-section"><div class="popup-section-label">🍽 Dining</div><ul class="room-list" style="list-style:none;padding:0">
        ${entry.dining.map(d => `<li>• ${d}</li>`).join('')}</ul></div>`;
  }
  if (uniqueRooms.length) {
    html += `<div class="popup-section"><div class="popup-section-label">📍 Rooms</div><ul class="room-list" style="list-style:none;padding:0">
        ${uniqueRooms.map(r => `<li>${r}</li>`).join('')}</ul></div>`;
  }
  if (entry.url) html += `<a class="popup-link" href="${entry.url}" target="_blank" rel="noopener">🔗 Visit website ↗</a>`;

  return html;
}

function flyToBuilding(entry) {
  const center = getFeatureCenter(entry.feature);
  if (highlightLayer && map.hasLayer(highlightLayer)) highlightLayer.remove();
  if (pulseMarker    && map.hasLayer(pulseMarker))    pulseMarker.remove();

  highlightLayer = L.geoJSON(entry.feature, {
    style: { color: '#7c3aed', weight: 4, opacity: 1, fillColor: '#7c3aed', fillOpacity: 0.28 }
  }).addTo(map);

  const icon = L.divIcon({ className: 'building-pulse-marker', html: '<div></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
  pulseMarker = L.marker(center, { icon }).addTo(map);
  highlightLayer.bindPopup(buildingPopupHtml(entry)).openPopup();
  map.flyTo(center, 18, { duration: 1.1 });
}

function searchBuildings(query) {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const results = [];
  const seen    = new Set();

  buildingIndex.forEach(entry => {
    if (seen.has(entry.name)) return;
    if (entry.name.toLowerCase().includes(q)) { seen.add(entry.name); results.push({ entry, matchType: 'name', matchText: entry.name }); return; }
    const akaHit = entry.aka.find(a => a.toLowerCase().includes(q));
    if (akaHit) { seen.add(entry.name); results.push({ entry, matchType: 'aka', matchText: akaHit }); return; }
    const deptHit = entry.departments.find(d => d.toLowerCase().includes(q));
    if (deptHit) { seen.add(entry.name); results.push({ entry, matchType: 'dept', matchText: deptHit }); return; }
    const officeHit = entry.offices.find(o => o.toLowerCase().includes(q));
    if (officeHit) { seen.add(entry.name); results.push({ entry, matchType: 'office', matchText: officeHit }); return; }
    const diningHit = entry.dining.find(d => d.toLowerCase().includes(q));
    if (diningHit) { seen.add(entry.name); results.push({ entry, matchType: 'dining', matchText: diningHit }); return; }
    const roomHit = entry.rooms.find(r => r.toLowerCase().includes(q));
    if (roomHit) { seen.add(entry.name); results.push({ entry, matchType: 'room', matchText: roomHit }); }
  });
  return results.slice(0, 20);
}

const searchInput = document.getElementById('buildingSearch');
const searchClear = document.getElementById('searchClear');
const dropdown    = document.getElementById('buildingDropdown');

const badgeLabels = { aka: 'alias', room: 'room', dept: 'dept', office: 'office', dining: 'dining' };

function renderDropdown(results) {
  if (!results.length) { dropdown.style.display = 'none'; return; }
  dropdown.innerHTML = results.map(({ entry, matchType, matchText }) => {
    const showBadge = matchType !== 'name';
    const subLine = showBadge ? `<span class="match-badge ${matchType}">${badgeLabels[matchType] || matchType}</span>${matchText}` : (entry.departments[0] || '');
    return `<div class="dropdown-item" data-name="${entry.name}"><span class="item-name">${entry.name}</span>${subLine ? `<span class="item-sub">${subLine}</span>` : ''}</div>`;
  }).join('');
  dropdown.style.display = 'block';

  dropdown.querySelectorAll('.dropdown-item').forEach(el => {
    el.addEventListener('click', () => {
      const entry = buildingIndex.find(e => e.name === el.dataset.name);
      if (entry) { searchInput.value = entry.name; searchClear.style.display = 'block'; dropdown.style.display = 'none'; flyToBuilding(entry); }
    });
  });
}

searchInput.addEventListener('input', () => { searchClear.style.display = searchInput.value ? 'block' : 'none'; renderDropdown(searchBuildings(searchInput.value)); });
searchClear.addEventListener('click', () => { searchInput.value = ''; searchClear.style.display = 'none'; dropdown.style.display = 'none'; if (highlightLayer) highlightLayer.remove(); if (pulseMarker) pulseMarker.remove(); });

/* ═══════════════════════════════════════════════════
   MODE TABS & LOADING
═══════════════════════════════════════════════════ */
function setMode(mode) {
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  const pCtrl = document.getElementById('parkingControls');
  const bCtrl = document.getElementById('buildingControls');

  if (mode === 'parking') {
    pCtrl.classList.remove('hidden'); bCtrl.classList.add('hidden');
    if (buildingLayer) buildingLayer.remove();
    showParkingLayer(activePassVal);
  } else {
    pCtrl.classList.add('hidden'); bCtrl.classList.remove('hidden');
    Object.values(parkingLayerCache).forEach(l => l.remove());
    if (buildingData && !buildingLayer) {
        buildingLayer = L.geoJSON(buildingData, { style: { color: '#5b21b6', weight: 1.5, opacity: 0.7, fillColor: '#ddd6fe', fillOpacity: 0.35 } });
    }
    buildingLayer.addTo(map);
  }
}

document.querySelectorAll('.mode-tab').forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

Promise.all([
  fetch('furman_parking.geojson').then(r => r.json()),
  fetch('furman_buildings.geojson').then(r => r.json())
]).then(([parking, buildings]) => {
  parkingData = parking; buildingData = buildings;
  buildSearchIndex(buildings); showParkingLayer(null); maskLayer.addTo(map);
});

document.querySelectorAll('.pass-btn').forEach(btn => btn.addEventListener('click', () => selectPass(btn.dataset.val)));