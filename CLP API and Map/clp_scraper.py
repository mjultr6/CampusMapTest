from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from webdriver_manager.chrome import ChromeDriverManager
from bs4 import BeautifulSoup
import json
import time
import re
from datetime import datetime

options = webdriver.ChromeOptions()
options.add_argument("--headless")
options.add_argument("--no-sandbox")
options.add_argument("--disable-dev-shm-usage")
options.add_argument("--window-size=1920,4000")

driver = webdriver.Chrome(
    service=Service(ChromeDriverManager().install()),
    options=options
)

all_events = []
seen_event_ids = set()

# ── Date range: start of last school year → end of summer CLPs ───────────────
DATE_START = datetime(2025, 8, 1)   # Beginning of current school year (early August 2025)
DATE_END   = datetime(2026, 7, 31)  # End of summer CLPs (end of July 2026)

def parse_event_date(date_str):
    """Parse 'Month D, YYYY' into a datetime object. Returns None if unparseable."""
    try:
        return datetime.strptime(date_str.strip(), "%B %d, %Y")
    except:
        return None

def in_range(date_str):
    """Return True if the event date falls within DATE_START and DATE_END."""
    dt = parse_event_date(date_str)
    if dt is None:
        return False
    return DATE_START <= dt <= DATE_END


def close_popup():
    """Close any fancybox or overlay popup on the main page."""
    try:
        driver.switch_to.default_content()
        overlay = driver.find_element(By.CLASS_NAME, "fancybox-overlay")
        if overlay.is_displayed():
            try:
                close_btn = driver.find_element(By.CLASS_NAME, "fancybox-close")
                close_btn.click()
            except:
                driver.execute_script("""
                    var overlays = document.querySelectorAll('.fancybox-overlay, .fancybox-wrap');
                    overlays.forEach(function(el) { el.remove(); });
                """)
            time.sleep(1)
            print("  🔒 Closed popup overlay")
    except:
        pass


def scrape_current_view():
    """Scrape all events from the current calendar view."""
    try:
        calendar_iframe = driver.find_element(
            By.XPATH, "//iframe[contains(@title, 'Classic Multi-Week Calendar')]"
        )
        driver.switch_to.frame(calendar_iframe)
        time.sleep(2)

        soup = BeautifulSoup(driver.page_source, "html.parser")

        header = soup.find("h1")
        period = header.text.strip() if header else "Unknown"
        print(f"\n📆 Scraping: {period}")

        events = []
        for div in soup.find_all("div", class_="twMultiWeekEvent"):
            url_event_id = div.get("url.eventid", "")
            if not url_event_id or url_event_id in seen_event_ids:
                continue

            strong = div.find("strong")
            time_str = strong.text.strip() if strong else ""
            anchor = div.find("a")
            if not anchor:
                continue
            title = anchor.text.strip()

            checkbox = div.find("input", {"type": "checkbox"})
            date_str = ""
            if checkbox:
                aria = checkbox.get("aria-label", "")
                match = re.search(
                    r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}',
                    aria
                )
                date_str = match.group(0) if match else ""

            # ── Skip events outside our date range ───────────────────────────
            if date_str and not in_range(date_str):
                print(f"  ⏭  Skipping (out of range): {date_str} — {title}")
                seen_event_ids.add(url_event_id)  # still mark as seen
                continue

            detail_url = f"https://25livepub.collegenet.com/calendars/clp?trumbaEmbed=view%3Devent%26eventid%3D{url_event_id}"

            seen_event_ids.add(url_event_id)
            events.append({
                "title": title,
                "date": date_str,
                "time": time_str,
                "event_id": url_event_id,
                "detail_url": detail_url,
                "location": ""
            })
            print(f"  + {date_str} {time_str} — {title}")

        driver.switch_to.default_content()
        return events

    except Exception as e:
        print(f"  ⚠️ Error scraping view: {e}")
        driver.switch_to.default_content()
        return []


def click_previous():
    """Click the Previous Page arrow inside the calendar iframe."""
    try:
        close_popup()

        calendar_iframe = driver.find_element(
            By.XPATH, "//iframe[contains(@title, 'Classic Multi-Week Calendar')]"
        )
        driver.switch_to.frame(calendar_iframe)
        time.sleep(1)

        prev_btn = driver.find_element(By.CLASS_NAME, "twPagerArrowLeft")
        driver.execute_script("arguments[0].click();", prev_btn)
        time.sleep(4)

        driver.switch_to.default_content()
        return True

    except Exception as e:
        print(f"  ⚠️ Could not click previous: {e}")
        driver.switch_to.default_content()
        return False


# ── STEP 1: Load the page ─────────────────────────────────────────────────────

print("Loading Furman CLP calendar...")
print(f"Date range: {DATE_START.strftime('%B %d, %Y')} → {DATE_END.strftime('%B %d, %Y')}")
driver.get("https://www.furman.edu/academics/cultural-life-program/upcoming-clp-events/")
time.sleep(8)

# Scrape current view first
all_events.extend(scrape_current_view())

# ── STEP 2: Click back until we pass DATE_START ───────────────────────────────
# Max weeks to go back: ~120 weeks covers Aug 2024 from mid-2026
MAX_WEEKS_BACK = 120
stopped_early = False

for i in range(MAX_WEEKS_BACK):
    print(f"\n⬅️  Going back... ({i+1}/{MAX_WEEKS_BACK})")
    success = click_previous()
    if not success:
        print("Could not go back further, stopping.")
        break

    new_events = scrape_current_view()

    # Check if we've gone past DATE_START — if all events on this page are
    # before DATE_START, stop scraping backwards
    if new_events:
        all_events.extend(new_events)
    else:
        # No new in-range events on this page — check if we're past the start date
        # by checking the page header date
        try:
            calendar_iframe = driver.find_element(
                By.XPATH, "//iframe[contains(@title, 'Classic Multi-Week Calendar')]"
            )
            driver.switch_to.frame(calendar_iframe)
            soup = BeautifulSoup(driver.page_source, "html.parser")
            header = soup.find("h1")
            page_period = header.text.strip() if header else ""
            driver.switch_to.default_content()

            # Try to parse a year from the header — if it's before 2024, stop
            year_match = re.search(r'20\d{2}', page_period)
            if year_match and int(year_match.group()) < 2024:
                print(f"  ⛔ Reached {page_period}, before date range. Stopping.")
                stopped_early = True
                break
        except:
            driver.switch_to.default_content()

    if stopped_early:
        break

print(f"\n\nFound {len(all_events)} unique events in range total.")
print("Now fetching locations from detail pages...\n")

# ── STEP 3: Fetch location for each event ─────────────────────────────────────

for i, event in enumerate(all_events):
    try:
        driver.get(event["detail_url"])
        time.sleep(2.5)

        soup = BeautifulSoup(driver.page_source, "html.parser")

        og_desc = soup.find("meta", property="og:description")
        if og_desc:
            content = og_desc.get("content", "")
            location_match = re.split(
                r'\d{1,2}(?::\d{2})?\s*(?:-\s*\d{1,2}(?::\d{2})?\s*)?[ap]m\s+',
                content
            )
            if len(location_match) > 1:
                event["location"] = location_match[-1].strip()

        print(f"[{i+1}/{len(all_events)}] {event['title'][:50]} → {event['location'] or 'NO LOCATION'}")

    except Exception as e:
        print(f"  ⚠️ Error: {e}")

driver.quit()

# ── STEP 4: Save and print unique locations ───────────────────────────────────

with open("clp_all_events.json", "w") as f:
    json.dump(all_events, f, indent=2)

print("\n\n========== ALL UNIQUE LOCATIONS ==========")
locations = sorted(set(e["location"] for e in all_events if e["location"]))
for loc in locations:
    print(f"  📍 {loc}")

# Extract unique building names (first part before room number)
print("\n\n========== UNIQUE BUILDINGS ==========")
buildings = set()
for loc in locations:
    building = re.split(r'\d{3}|,', loc)[0].strip()
    buildings.add(building)

for b in sorted(buildings):
    print(f"  🏛️  {b}")

print(f"\n✅ {len(all_events)} events saved to clp_all_events.json")
print(f"✅ {len(locations)} unique locations found")
print(f"✅ {len(buildings)} unique buildings found")
print(f"✅ Date range: {DATE_START.strftime('%B %d, %Y')} → {DATE_END.strftime('%B %d, %Y')}")