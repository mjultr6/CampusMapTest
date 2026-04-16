let map, parkingLayer, buildingLayer, buildingData, buildingIndex = [];
let highlightLayer, pulseMarker;

const passColors = { Green: '#00cc00', Yellow: '#ffcc00', BabyBlue: '#00a9f9', Silver: '#808080', Orange: '#ff8c00', Purple: '#9932cc', All: '#FA9BCF' };

async function init() {
    map = L.map('map', { center: [34.9260, -82.4375], zoom: 16, zoomControl: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);

    const [pRes, bRes] = await Promise.all([
        fetch(PARKING_GEOJSON).then(r => r.json()),
        fetch(BUILDINGS_DATA).then(r => r.json())
    ]);

    buildingData = bRes;
    buildingIndex = bRes.features.map(f => ({ name: f.properties.name || "Unnamed", feature: f }));

    parkingLayer = L.geoJSON(pRes, {
        style: { color: "#3388ff", weight: 2, fillOpacity: 0.1 },
        onEachFeature: (f, l) => l.bindPopup(`<strong>${f.properties.name || 'Lot'}</strong><br>Permit: ${f.properties.pass || 'None'}`)
    }).addTo(map);

    setupUI();
}

function setupUI() {
    // Mode Toggling
    document.querySelectorAll('.mode-tab').forEach(tab => {
        tab.onclick = () => {
            const mode = tab.dataset.mode;
            document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            if (mode === 'parking') {
                document.getElementById('parkingControls').classList.remove('hidden');
                document.getElementById('buildingControls').classList.add('hidden');
                if (buildingLayer) map.removeLayer(buildingLayer);
                parkingLayer.addTo(map);
            } else {
                document.getElementById('parkingControls').classList.add('hidden');
                document.getElementById('buildingControls').classList.remove('hidden');
                map.removeLayer(parkingLayer);
                if (!buildingLayer) buildingLayer = L.geoJSON(buildingData, { style: { color: '#5b21b6', weight: 1, fillOpacity: 0.1 } });
                buildingLayer.addTo(map);
            }
        };
    });

    // Pass Selection
    document.getElementById('passSelect').onchange = (e) => {
        const val = e.target.value;
        parkingLayer.eachLayer(l => {
            const passes = l.feature.properties.pass || [];
            const match = val === 'base' || (Array.isArray(passes) ? passes.includes(val) : passes === val);
            l.setStyle(match ? { color: passColors[val] || '#3388ff', weight: 4, fillOpacity: 0.5 } : { color: '#ddd', weight: 1, fillOpacity: 0.05 });
        });
    };

    // Building Search
    const input = document.getElementById('buildingSearch');
    const drop = document.getElementById('buildingDropdown');
    input.oninput = () => {
        const q = input.value.toLowerCase();
        if (!q) { drop.style.display = 'none'; return; }
        const hits = buildingIndex.filter(b => b.name.toLowerCase().includes(q)).slice(0, 5);
        drop.innerHTML = hits.map(h => `<div class="dropdown-item" data-name="${h.name}">${h.name}</div>`).join('');
        drop.style.display = hits.length ? 'block' : 'none';
    };

    drop.onclick = (e) => {
        const item = e.target.closest('.dropdown-item');
        if (item) {
            const entry = buildingIndex.find(b => b.name === item.dataset.name);
            const center = L.geoJSON(entry.feature).getBounds().getCenter();
            if (pulseMarker) map.removeLayer(pulseMarker);
            pulseMarker = L.marker(center, { icon: L.divIcon({ className: 'building-pulse-marker', html: '<div></div>' }) }).addTo(map);
            map.flyTo(center, 18);
            drop.style.display = 'none';
            input.value = entry.name;
        }
    };
}

init();