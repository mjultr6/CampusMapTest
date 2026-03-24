from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from bs4 import BeautifulSoup
import json
import re
import time
from datetime import datetime, timedelta

# --- 1. DYNAMIC SEASON LOGIC ---
today = datetime.now()
season_start_year = today.year - 1 if today.month < 8 else today.year
season_start = datetime(season_start_year, 8, 1)
season_end = datetime(season_start_year + 1, 7, 1)

# --- 2. CONSTANTS ---
GOLF_SPORTS = {"golf", "men's golf", "women's golf"}

FACILITY_ALIASES = {
    "Furman University Golf Course": "Furman Golf Course",
    "GREENVILLE": "Mickel Tennis Center" # Base alias for tennis logic
}

# Locations that indicate an away or neutral site game
EXCLUDE_LOCATIONS = {
    "Asheville, N.C.",
    "Boiling Springs, N.C.",
    "Boone, N.C.",
    "Cary, N.C.",
    "Charlotte, N.C.",
    "Conway, S.C.",
    "Durham, N.C.",
    "Harrah's Cherokee Center - Asheville",
    "Orlando, Fla. (USTA National Campus)",
    "Rock Hill, S.C.",
    "Tryon Equestrian Center",
    "Xfinity Mobile Arena"
}

JUNK_PATTERNS = [
    r"^(No\.|Higher|Lower|Top)\s",  # Bracket placeholders
    r",\s[A-Z][a-z]+\.$",           # "City, St." format
    r"\d+ Seed",                     # "No. 1 Seed" variants
]

# --- 3. HELPERS ---
def is_junk_facility(name: str) -> bool:
    if name in EXCLUDE_LOCATIONS:
        return True
    for pattern in JUNK_PATTERNS:
        if re.search(pattern, name):
            return True
    return False

def resolve_facility(sport: str, event_soup) -> str:
    """Pull facility name directly from scraped event HTML."""
    if sport.lower() in GOLF_SPORTS:
        return "Furman Golf Course"

    location_tag = (
        event_soup.find(class_="sidearm-calendar-schedule-event-location") or
        event_soup.find(class_="location") or
        event_soup.find("address")
    )

    venue_candidate = "Furman Campus" # Default

    if location_tag:
        children = [c.get_text(strip=True) for c in location_tag.find_all("span") if c.get_text(strip=True)]
        if children:
            venue_candidate = children[-1] if len(children) > 1 else children[0]
        else:
            full_text = location_tag.get_text(strip=True)
            venue_candidate = re.sub(r'^[A-Z ,\.]+(?=[A-Z][a-z])', '', full_text).strip()
            if not venue_candidate:
                venue_candidate = full_text

    # --- SPECIFIC FILTERING LOGIC ---
    
    # 1. Check Exclusion List First
    if venue_candidate in EXCLUDE_LOCATIONS:
        return None

    # 2. Handle Women's Tennis Greenville -> Mickel Tennis Center
    if "Tennis" in sport and venue_candidate.upper() == "GREENVILLE":
        return "Mickel Tennis Center"

    # 3. Normalize aliases (e.g., Golf Course)
    venue_candidate = FACILITY_ALIASES.get(venue_candidate, venue_candidate)

    # 4. Final Junk Check
    if is_junk_facility(venue_candidate):
        return None

    return venue_candidate

# --- 4. SELENIUM SETUP ---
options = webdriver.ChromeOptions()
options.add_argument("--headless")
options.add_argument("--window-size=1920,3000")
driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

home_games_only = []
seen_ids = set()
current_pointer = season_start

print(f"🏟️  Targeting Home Games for Season: {season_start_year}-{season_start_year+1}")

try:
    while current_pointer <= season_end:
        date_str = current_pointer.strftime("%-m/%-d/%Y")
        url = f"https://furmanpaladins.com/calendar?date={date_str}&vtype=list"

        print(f"📅 Checking week of {date_str}...")
        driver.get(url)
        time.sleep(4)

        soup = BeautifulSoup(driver.page_source, "html.parser")
        day_boxes = soup.find_all('article', class_='sidearm-calendar-schedule-day')

        for day in day_boxes:
            date_header = day.find('h4')
            if not date_header:
                continue

            display_date = date_header.get_text(strip=True)
            events = day.find_all('article', class_='sidearm-calendar-schedule-event')

            for event in events:
                try:
                    details = event.find('h5', class_='hide')
                    if not details:
                        continue

                    spans = details.find_all('span')
                    if len(spans) < 4:
                        continue

                    # Capture 'vs' or 'at' logic
                    is_home = spans[1].get_text(strip=True).lower() == 'vs'
                    if not is_home:
                        continue

                    sport    = spans[0].get_text(strip=True)
                    opponent = spans[2].get_text(strip=True)
                    time_str = spans[3].get_text(strip=True)

                    event_id = f"{display_date}-{sport}-{opponent}-{time_str}"
                    if event_id in seen_ids:
                        continue

                    facility = resolve_facility(sport, event)

                    # If facility returned None, it was filtered out by our logic
                    if not facility:
                        print(f"   🛑 Filtered out away/junk venue for {sport} vs {opponent}")
                        continue

                    home_games_only.append({
                        "sport":    sport,
                        "opponent": opponent,
                        "date":     display_date,
                        "time":     time_str,
                        "facility": facility,
                    })
                    seen_ids.add(event_id)
                    print(f"   ✅ Added: {sport} vs {opponent} at {facility}")

                except Exception as e:
                    print(f"   ⚠️  Skipped event due to error: {e}")
                    continue

        current_pointer += timedelta(days=7)

    # --- 5. SAVE ---
    output_file = "furman_home_map_data.json"
    with open(output_file, "w") as f:
        json.dump(home_games_only, f, indent=4)

    print(f"\n✨ FINISHED! Saved {len(home_games_only)} home games to {output_file}.")

finally:
    driver.quit()