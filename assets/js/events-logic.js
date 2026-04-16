/* ═══════════════════════════════════════════════════
   STATE & CONSTANTS
═══════════════════════════════════════════════════ */
let map; // Global map instance
let clpEvents = [];
let athleticsEvents = [];
let clpByDate = {};
let athleticsByDate = {};
let clpDatesSet = new Set();
let athleticsDatesSet = new Set();
let featureLayerMap = {};
let calViewDate = new Date();
let selectedDate = '';
let showCLPLayer = true;
let showAthleticsLayer = true;

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// Map Styles (Light Theme Palette)
const styleBase = { color: 'rgba(130,90,200,0.25)', weight: 1, fillColor: 'rgba(80,50,130,0.15)', fillOpacity: 1 };
const styleCLP = { color: '#9B6FD4', weight: 2.5, fillColor: '#9B6FD4', fillOpacity: 0.35 };
const styleAthletics = { color: '#C9991A', weight: 2.5, fillColor: '#C9991A', fillOpacity: 0.35 };
const styleBoth = { color: '#C9A8F0', weight: 2.5, fillColor: '#9B6FD4', fillOpacity: 0.30 };
const styleHoverCLP = { color: '#7C3AED', weight: 3, fillColor: '#9B6FD4', fillOpacity: 0.6 };
const styleHoverAth = { color: '#C9991A', weight: 3, fillColor: '#C9991A', fillOpacity: 0.6 };
const styleHoverBoth = { color: '#7C3AED', weight: 3, fillColor: '#9B6FD4', fillOpacity: 0.5 };

/* ═══════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════ */
function isMobile() { return window.innerWidth < 600; }

function getActiveStyle(hasCLP, hasAth) {
    if (hasCLP && hasAth) return styleBoth;
    if (hasCLP) return styleCLP;
    if (hasAth) return styleAthletics;
    return styleBase;
}

function getHoverStyle(hasCLP, hasAth) {
    if (hasCLP && hasAth) return styleHoverBoth;
    if (hasCLP) return styleHoverCLP;
    if (hasAth) return styleHoverAth;
    return styleBase;
}

function normalizeAthleticsDate(dateStr) {
    if (!dateStr) return '';
    let s = dateStr.trim();
    s = s.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*/i, '');
    s = s.replace(/(\d+)(st|nd|rd|th),/i, '$1,');
    return s.trim();
}

const ROOM_TO_BUILDING = {
    "Amphitheater": "Amphitheater",
    "Chapel Main Sanctuary": "Daniel Chapel",
    "Daniel Recital Hall": "Daniel Music Building",
    "Furman Hall 214": "Furman Hall",
    "Johns Hall 101": "Johns Hall",
    "McAlister Auditorium": "McAlister Auditorium",
    "Patrick Lecture Hall": "Plyler Hall",
    "Playhouse": "Playhouse",
    "Trone Student Center": "Trone Student Center",
    "Younts Conference Center": "Younts Conference Center",
    "Hartness Pavilion": "Daniel Dining Hall"
};

function getBuildingForCLPLocation(loc) {
    if (!loc) return null;
    for (const [key, bid] of Object.entries(ROOM_TO_BUILDING)) {
        if (loc.includes(key)) return bid;
    }
    return null;
}

/* ═══════════════════════════════════════════════════
   MAP UPDATE LOGIC
═══════════════════════════════════════════════════ */
function updateLayerForDate(date) {
    const noMsg = document.getElementById('noDateMsg');
    if (!date) {
        if (noMsg) noMsg.style.display = 'block';
        return;
    }
    if (noMsg) noMsg.style.display = 'none';

    const dayCLP = showCLPLayer ? (clpByDate[date] || []) : [];
    const dayAth = showAthleticsLayer ? (athleticsByDate[date] || []) : [];

    // Map events to buildings
    const clpBuilding = {};
    dayCLP.forEach(ev => {
        const bid = getBuildingForCLPLocation(ev.location);
        if (bid) (clpBuilding[bid] ||= []).push(ev);
    });

    const athBuilding = {};
    dayAth.forEach(ev => {
        const f = ev.facility ? ev.facility.trim() : '';
        const bid = (f === 'Alley Gymnasium') ? 'Timmons Arena' : f;
        if (bid) (athBuilding[bid] ||= []).push(ev);
    });

    document.getElementById('eventCount').innerHTML = `<strong>${dayCLP.length}</strong> CLP • <strong class="gold">${dayAth.length}</strong> Games`;

    Object.values(featureLayerMap).forEach(({ layer, feature }) => {
        const name = feature.properties.name || '';
        const clpEvs = clpBuilding[name] || [];
        const athEvs = athBuilding[name] || [];
        
        layer._hasCLP = clpEvs.length > 0;
        layer._hasAthletics = athEvs.length > 0;
        layer.setStyle(getActiveStyle(layer._hasCLP, layer._hasAthletics));

        // Build HTML
        let html = `<div class="popup-inner"><div class="popup-building">📍 ${name}</div>`;
        if (!layer._hasCLP && !layer._hasAthletics) {
            html += `<div class="popup-no-events">No events scheduled.</div>`;
        } else {
            if (clpEvs.length) {
                html += `<div class="popup-section-label">🎓 CLP</div>`;
                clpEvs.forEach(e => html += `<div class="popup-event"><strong>${e.title}</strong><br><small>🕒 ${e.time}</small></div>`);
            }
            if (athEvs.length) {
                html += `<div class="popup-section-label">🏀 Athletics</div>`;
                athEvs.forEach(e => html += `<div class="popup-event"><strong>${e.sport} vs ${e.opponent}</strong><br><small>🕒 ${e.time}</small></div>`);
            }
        }
        html += `</div>`;

        if (isMobile()) {
            layer.off('click').on('click', () => {
                document.getElementById('sheetContent').innerHTML = html;
                document.getElementById('bottomSheet').classList.add('open');
            });
        } else {
            layer.bindPopup(html);
        }
    });
}

/* ═══════════════════════════════════════════════════
   CALENDAR LOGIC
═══════════════════════════════════════════════════ */
function renderCalendar() {
    const grid = document.getElementById('calGrid');
    const label = document.getElementById('calMonthLabel');
    if (!grid || !label) return;

    const y = calViewDate.getFullYear();
    const m = calViewDate.getMonth();
    label.textContent = MONTHS[m] + ' ' + y;
    grid.innerHTML = '';

    DAYS.forEach(d => {
        const el = document.createElement('div'); el.className = 'cal-dow'; el.textContent = d; grid.appendChild(el);
    });

    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
        const el = document.createElement('div'); el.className = 'cal-day empty'; grid.appendChild(el);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = MONTHS[m] + ' ' + d + ', ' + y;
        const el = document.createElement('div');
        el.className = 'cal-day';
        el.textContent = d;
        if (showCLPLayer && clpDatesSet.has(dateStr)) el.classList.add('has-clp');
        if (showAthleticsLayer && athleticsDatesSet.has(dateStr)) el.classList.add('has-athletics');
        if (dateStr === selectedDate) el.classList.add('selected');
        
        el.onclick = () => {
            selectedDate = dateStr;
            document.getElementById('calBtnText').textContent = dateStr;
            document.getElementById('calPopup').classList.remove('open');
            renderCalendar();
            updateLayerForDate(dateStr);
        };
        grid.appendChild(el);
    }
}

/* ═══════════════════════════════════════════════════
   INITIALIZATION
═══════════════════════════════════════════════════ */
async function loadData() {
    // 1. Initialize Map Object First to prevent "addLayer" errors
    map = L.map('map', {
        center: [34.9260, -82.4375],
        zoom: isMobile() ? 15 : 16,
        zoomControl: false
    });

    L.control.zoom({ position: 'topleft' }).addTo(map);

    // 2. Add Tile Layer (Light Theme)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CARTO'
    }).addTo(map);

    // 3. Fetch Data
    try {
        const [geoRes, clpRes, athRes] = await Promise.all([
            fetch(BUILDINGS_DATA).then(r => r.json()),
            fetch(CLP_DATA).then(r => r.json()),
            fetch(ATHLETICS_DATA).then(r => r.json())
        ]);

        clpEvents = clpRes;
        clpEvents.forEach(ev => { if(ev.date) (clpByDate[ev.date.trim()] ||= []).push(ev); });
        clpDatesSet = new Set(Object.keys(clpByDate));

        athleticsEvents = athRes;
        athleticsEvents.forEach(ev => { 
            const d = normalizeAthleticsDate(ev.date);
            if(d) (athleticsByDate[d] ||= []).push(ev); 
        });
        athleticsDatesSet = new Set(Object.keys(athleticsByDate));

        // 4. Add GeoJSON to Map
        L.geoJSON(geoRes, {
            style: styleBase,
            onEachFeature: (f, layer) => {
                if (f.properties && f.properties.name) {
                    featureLayerMap[f.properties.name] = { layer, feature: f };
                }
                layer.on('mouseover', function() { 
                    if(this._hasCLP || this._hasAthletics) this.setStyle(getHoverStyle(this._hasCLP, this._hasAthletics)); 
                });
                layer.on('mouseout', function() { 
                    if(this._hasCLP || this._hasAthletics) this.setStyle(getActiveStyle(this._hasCLP, this._hasAthletics)); 
                });
            }
        }).addTo(map);

        renderCalendar();
    } catch (e) {
        console.error("Error loading map data:", e);
    }
}

// Global UI Listeners
document.getElementById('prevMonth').onclick = (e) => { e.stopPropagation(); calViewDate.setMonth(calViewDate.getMonth() - 1); renderCalendar(); };
document.getElementById('nextMonth').onclick = (e) => { e.stopPropagation(); calViewDate.setMonth(calViewDate.getMonth() + 1); renderCalendar(); };
document.getElementById('calBtn').onclick = (e) => { e.stopPropagation(); document.getElementById('calPopup').classList.toggle('open'); };
document.getElementById('sheetClose').onclick = () => document.getElementById('bottomSheet').classList.remove('open');

document.querySelectorAll('.layer-toggle').forEach(btn => {
    btn.onclick = () => {
        if(btn.dataset.layer === 'clp') showCLPLayer = !showCLPLayer;
        else showAthleticsLayer = !showAthleticsLayer;
        btn.classList.toggle('on');
        updateLayerForDate(selectedDate);
        renderCalendar();
    };
});

// Close popup on outside click
document.addEventListener('click', (e) => {
    const pop = document.getElementById('calPopup');
    if (pop && !pop.contains(e.target) && e.target.id !== 'calBtn') pop.classList.remove('open');
});

// Start the engine
loadData();