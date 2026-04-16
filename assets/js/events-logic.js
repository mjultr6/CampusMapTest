/* ═══════════════════════════════════════════════════
   STATE & CONSTANTS
═══════════════════════════════════════════════════ */
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

// Map Styles
const styleBase = { color: 'rgba(130,90,200,0.25)', weight: 1, fillColor: 'rgba(80,50,130,0.15)', fillOpacity: 1 };
const styleCLP = { color: '#9B6FD4', weight: 2.5, fillColor: '#9B6FD4', fillOpacity: 0.35 };
const styleAthletics = { color: '#C9991A', weight: 2.5, fillColor: '#C9991A', fillOpacity: 0.35 };
const styleBoth = { color: '#C9A8F0', weight: 2.5, fillColor: '#9B6FD4', fillOpacity: 0.30 };
const styleHoverCLP = { color: '#C9A8F0', weight: 3, fillColor: '#9B6FD4', fillOpacity: 0.6 };
const styleHoverAth = { color: '#F0C84A', weight: 3, fillColor: '#C9991A', fillOpacity: 0.6 };
const styleHoverBoth = { color: '#F0C84A', weight: 3, fillColor: '#9B6FD4', fillOpacity: 0.5 };

/* ═══════════════════════════════════════════════════
   HELPERS & MAPPING
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

const ROOM_TO_BUILDING = {
  "Amphitheater": "Amphitheater",
  "Chapel Main Sanctuary": "Daniel Chapel",
  "Chapel Bryan Garden Room": "Daniel Chapel",
  "Daniel Recital Hall": "Daniel Music Building",
  "Furman Hall 214 - McEachern Lecture Hall": "Furman Hall",
  "Johns Hall 101": "Johns Hall",
  "Johns Hall 109": "Johns Hall",
  "McAlister Auditorium": "McAlister Auditorium",
  "Patrick Lecture Hall": "Plyler Hall",
  "Roe Art Building Gallery": "Roe Art Building",
  "Roe Art Building Littlejohn Lecture Room": "Roe Art Building",
  "Playhouse": "Playhouse",
  "Trone Student Center Burgiss Theater": "Trone Student Center",
  "Trone Student Center Watkins Room": "Trone Student Center",
  "Younts Conference Center Great Hall": "Younts Conference Center",
  "Hartness Pavilion": "Daniel Dining Hall",
  "Trustees Dining Room": "Daniel Dining Hall"
};

function getBuildingForCLPLocation(loc) {
  if (!loc) return null;
  const clean = loc.replace(/….*$/, '').trim();
  if (ROOM_TO_BUILDING[clean]) return ROOM_TO_BUILDING[clean];
  const parts = clean.split(',').map(s => s.trim());
  for (const part of parts) { if (ROOM_TO_BUILDING[part]) return ROOM_TO_BUILDING[part]; }
  return null;
}

function getBuildingForFacility(facility) {
  if (!facility) return null;
  const f = facility.trim();
  if (f === 'Alley Gymnasium') return 'Timmons Arena';
  return f;
}

function normalizeAthleticsDate(dateStr) {
  if (!dateStr) return '';
  let s = dateStr.trim();
  s = s.replace(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*/i, '');
  s = s.replace(/(\d+)(st|nd|rd|th),/i, '$1,');
  return s.trim();
}

/* ═══════════════════════════════════════════════════
   POPUP BUILDER
═══════════════════════════════════════════════════ */
function buildPopupHTML(name, clpEvs, athEvs, showCLP, showAthletics) {
  let html = '<div class="popup-inner">';
  html += '<div class="popup-building">📍 ' + name + '</div>';
  const hasCLP = showCLP && clpEvs && clpEvs.length;
  const hasAth = showAthletics && athEvs && athEvs.length;
  
  if (!hasCLP && !hasAth) {
    html += '<div class="popup-no-events">No events on this date.</div>';
  } else {
    if (hasCLP) {
      html += '<div class="popup-section-label clp">🎓 CLP</div>';
      clpEvs.forEach(ev => {
        html += `<div class="popup-event"><div class="popup-event-title">${ev.title}</div>`;
        html += `<div class="popup-event-meta"><span class="popup-time clp">🕒 ${ev.time}</span><span class="popup-room">${ev.location}</span></div></div>`;
      });
    }
    if (hasAth) {
      html += '<div class="popup-section-label athletics">🏀 Athletics</div>';
      athEvs.forEach(ev => {
        html += `<div class="popup-event"><div class="popup-event-title">${ev.sport} vs ${ev.opponent}</div>`;
        html += `<div class="popup-event-meta"><span class="popup-time gold">🕒 ${ev.time}</span></div></div>`;
      });
    }
  }
  return html + '</div>';
}

/* ═══════════════════════════════════════════════════
   MAP UPDATE LOGIC
═══════════════════════════════════════════════════ */
function updateLayerForDate(date) {
  const noMsg = document.getElementById('noDateMsg');
  if (!date) {
    if(noMsg) noMsg.style.display = 'block';
    return;
  }
  if(noMsg) noMsg.style.display = 'none';

  const dayCLP = showCLPLayer ? (clpByDate[date] || []) : [];
  const dayAth = showAthleticsLayer ? (athleticsByDate[date] || []) : [];

  const clpBuilding = {};
  dayCLP.forEach(ev => {
    const bid = getBuildingForCLPLocation(ev.location);
    if (bid) (clpBuilding[bid] ||= []).push(ev);
  });

  const athBuilding = {};
  dayAth.forEach(ev => {
    const bid = getBuildingForFacility(ev.facility);
    if (bid) (athBuilding[bid] ||= []).push(ev);
  });

  document.getElementById('eventCount').innerHTML = `<strong>${dayCLP.length}</strong> CLP • <strong class="gold">${dayAth.length}</strong> Games`;

  Object.values(featureLayerMap).forEach(({ layer, feature }) => {
    const propName = feature.properties.name || '';
    const clpEvs = clpBuilding[propName] || [];
    const athEvs = athBuilding[propName] || [];
    
    layer._hasCLP = clpEvs.length > 0;
    layer._hasAthletics = athEvs.length > 0;
    layer.setStyle(getActiveStyle(layer._hasCLP, layer._hasAthletics));

    const html = buildPopupHTML(propName, clpEvs, athEvs, showCLPLayer, showAthleticsLayer);
    if (isMobile()) {
        layer.on('click', () => {
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
  const y = calViewDate.getFullYear();
  const m = calViewDate.getMonth();
  label.textContent = MONTHS[m] + ' ' + y;
  grid.innerHTML = '';

  DAYS.forEach(d => {
    const el = document.createElement('div'); el.className = 'cal-dow'; el.textContent = d; grid.appendChild(el);
  });

  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) grid.appendChild(Object.assign(document.createElement('div'), {className: 'cal-day empty'}));

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

  // Initialize Map
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CARTO' }).addTo(map);

  L.geoJSON(geoRes, {
    style: styleBase,
    onEachFeature: (f, layer) => {
      if (f.properties && f.properties.name) featureLayerMap[f.properties.name] = { layer, feature: f };
      layer.on('mouseover', function() { if(this._hasCLP || this._hasAthletics) this.setStyle(getHoverStyle(this._hasCLP, this._hasAthletics)); });
      layer.on('mouseout', function() { if(this._hasCLP || this._hasAthletics) this.setStyle(getActiveStyle(this._hasCLP, this._hasAthletics)); });
    }
  }).addTo(map);

  renderCalendar();
}

// Event Listeners
document.getElementById('prevMonth').onclick = () => { calViewDate.setMonth(calViewDate.getMonth() - 1); renderCalendar(); };
document.getElementById('nextMonth').onclick = () => { calViewDate.setMonth(calViewDate.getMonth() + 1); renderCalendar(); };
document.getElementById('calBtn').onclick = () => document.getElementById('calPopup').classList.toggle('open');
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

loadData();