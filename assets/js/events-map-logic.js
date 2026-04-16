/**
 * Furman University - Campus Events Map Logic (Light Theme)
 */

// ── State ─────────────────────────────────────────────────────────────────────
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

// ── Constants & Styles ────────────────────────────────────────────────────────
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// Light Theme Styles
const styleBase = { color: 'rgba(88, 44, 131, 0.15)', weight: 1.5, fillColor: '#E2E8F0', fillOpacity: 0.3 };
const styleCLP = { color: '#7C3AED', weight: 2.5, fillColor: '#7C3AED', fillOpacity: 0.3 };
const styleAthletics = { color: '#C9991A', weight: 2.5, fillColor: '#C9991A', fillOpacity: 0.3 };
const styleBoth = { color: '#582C83', weight: 2.5, fillColor: '#7C3AED', fillOpacity: 0.4 };

// ── Helpers ───────────────────────────────────────────────────────────────────
function isMobile() { return window.innerWidth < 600; }

function getActiveStyle(hasCLP, hasAth) {
    if (hasCLP && hasAth) return styleBoth;
    if (hasCLP) return styleCLP;
    if (hasAth) return styleAthletics;
    return styleBase;
}

// ── Room to Building Mapping ──────────────────────────────────────────────────
const ROOM_TO_BUILDING = {
    "Amphitheater": "Amphitheater",
    "Chapel Main Sanctuary": "Daniel Chapel",
    "Daniel Recital Hall": "Daniel Music Building",
    "Johns Hall 101": "Johns Hall",
    "McAlister Auditorium": "McAlister Auditorium",
    "Patrick Lecture Hall": "Plyler Hall",
    "Trone Student Center Watkins Room": "Trone Student Center",
    "Hartness Pavilion": "Daniel Dining Hall",
    "Alley Gymnasium": "Timmons Arena"
};

function getBuildingForCLPLocation(loc) {
    if (!loc) return null;
    const clean = loc.split(',')[0].trim();
    return ROOM_TO_BUILDING[clean] || null;
}

// ── Map Initialization ────────────────────────────────────────────────────────
const map = L.map('map', {
    center: [34.9260, -82.4375],
    zoom: isMobile() ? 15 : 16,
    zoomControl: false,
    maxBounds: [[34.91, -82.46], [34.94, -82.42]]
});

L.control.zoom({ position: 'topleft' }).addTo(map);

// Light Basemap (CARTO Voyager)
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 19
}).addTo(map);

// ── Data Loading & Processing ─────────────────────────────────────────────────
async function loadData() {
    try {
        const [geoRes, clpRes, athRes] = await Promise.all([
            fetch(BUILDINGS_GEOJSON).then(r => r.json()),
            fetch(CLP_EVENTS_JSON).then(r => r.json()),
            fetch(ATHLETICS_EVENTS_JSON).then(r => r.json())
        ]);

        // Process CLP
        clpEvents = clpRes || [];
        clpEvents.forEach(ev => {
            if (ev.date) (clpByDate[ev.date.trim()] ||= []).push(ev);
        });
        clpDatesSet = new Set(Object.keys(clpByDate));

        // Process Athletics
        athleticsEvents = athRes || [];
        athleticsEvents.forEach(ev => {
            let d = ev.date.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*/i, '').trim();
            (athleticsByDate[d] ||= []).push(ev);
        });
        athleticsDatesSet = new Set(Object.keys(athleticsByDate));

        // Load GeoJSON Layers
        L.geoJSON(geoRes, {
            style: styleBase,
            onEachFeature: (f, layer) => {
                const name = f.properties.name?.trim();
                if (name) featureLayerMap[name] = { layer, feature: f };
                
                layer.on('click', (e) => {
                    if (isMobile() && layer._popupContent) {
                        openBottomSheet(layer._popupContent);
                    }
                });
            }
        }).addTo(map);

        autoSelectDate();
    } catch (err) {
        console.error("Error loading map data:", err);
    }
}

// ── Core Logic: Update Map for Selected Date ──────────────────────────────────
function updateLayerForDate(date) {
    const noMsg = document.getElementById('noDateMsg');
    if (!date) {
        if (noMsg) noMsg.style.display = 'block';
        return;
    }
    if (noMsg) noMsg.style.display = 'none';

    const dayCLP = showCLPLayer ? (clpByDate[date] || []) : [];
    const dayAth = showAthleticsLayer ? (athleticsByDate[date] || []) : [];

    // Reset all styles
    Object.values(featureLayerMap).forEach(({ layer }) => {
        layer.setStyle(styleBase);
        layer.unbindPopup();
        layer._popupContent = null;
    });

    // Highlight CLP Buildings
    dayCLP.forEach(ev => {
        const bName = getBuildingForCLPLocation(ev.location);
        if (featureLayerMap[bName]) {
            const { layer } = featureLayerMap[bName];
            layer._hasCLP = true;
            applyEventStyle(layer, bName, date);
        }
    });

    // Highlight Athletics Buildings
    dayAth.forEach(ev => {
        const bName = ev.facility;
        if (featureLayerMap[bName]) {
            const { layer } = featureLayerMap[bName];
            layer._hasAth = true;
            applyEventStyle(layer, bName, date);
        }
    });

    updateEventCountLabel(dayCLP.length, dayAth.length);
}

function applyEventStyle(layer, bName, date) {
    const hasCLP = layer._hasCLP || false;
    const hasAth = layer._hasAth || false;
    layer.setStyle(getActiveStyle(hasCLP, hasAth));
    
    // Simple popup content generator
    const content = `<strong>${bName}</strong><br>Events scheduled for ${date}`;
    layer._popupContent = content;
    if (!isMobile()) layer.bindPopup(content);
}

// ── Calendar Rendering ────────────────────────────────────────────────────────
function renderCalendar() {
    const grid = document.getElementById('calGrid');
    const label = document.getElementById('calMonthLabel');
    if (!grid || !label) return;

    const y = calViewDate.getFullYear();
    const m = calViewDate.getMonth();
    label.textContent = `${MONTHS[m]} ${y}`;
    grid.innerHTML = '';

    // Add DOW Headers
    DAYS.forEach(d => {
        const el = document.createElement('div');
        el.className = 'cal-dow'; el.textContent = d; grid.appendChild(el);
    });

    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
        const el = document.createElement('div'); el.className = 'cal-day empty'; grid.appendChild(el);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${MONTHS[m]} ${d}, ${y}`;
        const el = document.createElement('div');
        el.className = 'cal-day';
        el.textContent = d;

        const hasCLP = showCLPLayer && clpDatesSet.has(dateStr);
        const hasAth = showAthleticsLayer && athleticsDatesSet.has(dateStr);

        if (hasCLP || hasAth) el.classList.add('has-event');
        if (dateStr === selectedDate) el.classList.add('selected');

        el.onclick = (e) => {
            e.stopPropagation();
            selectedDate = dateStr;
            document.getElementById('calBtnText').textContent = dateStr;
            document.getElementById('calPopup').classList.remove('open');
            renderCalendar();
            updateLayerForDate(dateStr);
        };
        grid.appendChild(el);
    }
}

// ── UI Interactions ───────────────────────────────────────────────────────────
function updateEventCountLabel(clpCount, athCount) {
    const el = document.getElementById('eventCount');
    if (!el) return;
    el.innerHTML = `<span>${clpCount} CLPs</span> | <span>${athCount} Games</span>`;
}

function autoSelectDate() {
    const today = new Date();
    const todayStr = `${MONTHS[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`;
    selectedDate = todayStr;
    document.getElementById('calBtnText').textContent = todayStr;
    renderCalendar();
    updateLayerForDate(todayStr);
}

function openBottomSheet(html) {
    const sheet = document.getElementById('bottomSheet');
    const content = document.getElementById('sheetContent');
    if (sheet && content) {
        content.innerHTML = html;
        sheet.classList.add('open');
    }
}

// ── Event Listeners ───────────────────────────────────────────────────────────
document.getElementById('prevMonth')?.addEventListener('click', (e) => {
    e.stopPropagation();
    calViewDate.setMonth(calViewDate.getMonth() - 1);
    renderCalendar();
});

document.getElementById('nextMonth')?.addEventListener('click', (e) => {
    e.stopPropagation();
    calViewDate.setMonth(calViewDate.getMonth() + 1);
    renderCalendar();
});

// Initialize
loadData();