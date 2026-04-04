#!/usr/bin/env python3
"""Enrich osm-campsites.geojson with pricing/hours scraped from campsite websites."""

import json
import re
import sys
import time
import requests
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse

DATA_FILE = 'data/osm-campsites.geojson'
OUTPUT_FILE = 'data/osm-campsites.geojson'

# Regex patterns for NZ campsite pricing
PRICE_PATTERNS = [
    # "$15/night", "$20 per night", "$25/person/night"
    r'\$(\d+(?:\.\d{2})?)\s*(?:/|per\s+)?\s*(?:per\s+)?(?:night|nite|pn)',
    r'\$(\d+(?:\.\d{2})?)\s*(?:/|per\s+)?\s*(?:per\s+)?(?:person|adult|pp|pppn)',
    r'\$(\d+(?:\.\d{2})?)\s*(?:/|per\s+)?\s*(?:per\s+)?(?:site|campsite|tent)',
    r'\$(\d+(?:\.\d{2})?)\s*(?:/|per\s+)?\s*(?:per\s+)?(?:powered|unpowered)',
    # "NZD 15", "15 NZD"
    r'(?:NZD|NZ\$)\s*(\d+(?:\.\d{2})?)',
    r'(\d+(?:\.\d{2})?)\s*NZD',
    # Generic "$15" near camping context
    r'(?:from|price|rate|cost|fee|charge)[:\s]*\$(\d+(?:\.\d{2})?)',
    # "15 dollars"
    r'(\d+(?:\.\d{2})?)\s*dollars?\s*(?:per|/|a)\s*(?:night|person|site|adult)',
]

HOURS_PATTERNS = [
    # "Open 24/7", "24 hours"
    r'(?:open\s+)?24\s*/\s*7',
    r'24\s*hours?',
    # "Check-in 2pm", "Check in: 14:00"
    r'check[\s-]*in[:\s]*(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)',
    r'check[\s-]*out[:\s]*(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)',
    # "Reception hours: 8am-6pm"
    r'(?:reception|office|hours)[:\s]*(\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*[-–to]+\s*\d{1,2}(?::\d{2})?\s*(?:am|pm))',
]

# Known NZ holiday park chains with typical pricing
CHAIN_PRICING = {
    'top 10': {'min': 20, 'max': 55, 'type': 'Holiday Park'},
    'kiwi holiday park': {'min': 18, 'max': 50, 'type': 'Holiday Park'},
    'doc ': {'min': 0, 'max': 15, 'type': 'DOC Campsite'},
    'freedom camp': {'min': 0, 'max': 0, 'type': 'Freedom Camping'},
    'nzmca': {'min': 0, 'max': 10, 'type': 'NZMCA Park'},
}

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; MotoCampBot/1.0; camping data enrichment)',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-NZ,en;q=0.9',
}


def extract_prices(text):
    """Extract all price values from text, return sorted unique list."""
    prices = []
    for pattern in PRICE_PATTERNS:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            try:
                price = float(match.group(1))
                if 0 < price < 500:  # Sanity check
                    prices.append(price)
            except (ValueError, IndexError):
                continue
    return sorted(set(prices))


def extract_hours(text):
    """Extract opening hours info from text."""
    text_lower = text.lower()
    if re.search(r'(?:open\s+)?24\s*/\s*7|24\s*hours?|always\s+open', text_lower):
        return '24/7'

    checkin = re.search(r'check[\s-]*in[:\s]*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)', text_lower)
    checkout = re.search(r'check[\s-]*out[:\s]*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)', text_lower)
    if checkin and checkout:
        return f"Check-in {checkin.group(1)}, Check-out {checkout.group(1)}"
    if checkin:
        return f"Check-in {checkin.group(1)}"

    return None


def format_price_range(prices):
    """Format a list of prices into a display string."""
    if not prices:
        return None
    prices = [p for p in prices if p > 0]
    if not prices:
        return 'Free'
    if len(prices) == 1:
        return f'${int(prices[0])}/night'
    return f'${int(min(prices))}–${int(max(prices))}/night'


def scrape_site(url, timeout=10):
    """Scrape a single campsite website for pricing and hours."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, 'lxml')

        # Remove script/style elements
        for tag in soup(['script', 'style', 'nav', 'footer', 'header']):
            tag.decompose()

        text = soup.get_text(separator=' ', strip=True)
        # Collapse whitespace
        text = re.sub(r'\s+', ' ', text)

        prices = extract_prices(text)
        hours = extract_hours(text)

        return {'prices': prices, 'hours': hours, 'url': url, 'success': True}
    except Exception as e:
        return {'prices': [], 'hours': None, 'url': url, 'success': False, 'error': str(e)[:100]}


def scrape_doc_site(url, timeout=10):
    """Scrape DOC campsite pages which have structured pricing."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, 'lxml')
        text = soup.get_text(separator=' ', strip=True)

        prices = extract_prices(text)

        # DOC-specific: look for "Free", "Adult $X", "Child $X"
        if re.search(r'\bfree\b', text, re.IGNORECASE) and not prices:
            return {'prices': [0], 'hours': '24/7', 'success': True}

        # DOC sites are generally 24/7
        return {'prices': prices, 'hours': '24/7', 'success': True}
    except Exception as e:
        return {'prices': [], 'hours': None, 'success': False, 'error': str(e)[:100]}


def estimate_from_name_and_props(props):
    """Estimate pricing from campsite name, type, and existing properties."""
    name = (props.get('name') or '').lower()

    # Already has charge info
    charge = props.get('charge')
    if charge and charge != 'MISSING':
        return charge, None

    # Fee explicitly no
    if props.get('fee') == 'no':
        return 'Free', None

    # Chain-based estimates
    for chain, info in CHAIN_PRICING.items():
        if chain in name:
            if info['min'] == 0 and info['max'] == 0:
                return 'Free', info['type']
            return f"${info['min']}–${info['max']}/night (est.)", info['type']

    # Operator-based
    operator = (props.get('operator') or '').lower()
    if 'department of conservation' in operator or 'doc' in operator:
        return None, 'DOC Campsite'

    # Tourism type hints
    tourism = props.get('tourism', '')
    if tourism == 'caravan_site' and props.get('fee') != 'yes':
        return None, None

    return None, None


def enrich_geojson():
    """Main enrichment pipeline."""
    with open(DATA_FILE) as f:
        data = json.load(f)

    features = data['features']
    print(f"Loaded {len(features)} campsites")

    # Collect sites that need scraping (have URLs, missing pricing)
    to_scrape = []
    enriched_from_props = 0

    for i, f in enumerate(features):
        props = f['properties']

        # Try to enrich from existing properties first
        est_price, est_type = estimate_from_name_and_props(props)
        if est_price and not props.get('_enriched_fee'):
            props['_enriched_fee'] = est_price
            enriched_from_props += 1

        # Queue for scraping if has URL and still missing fee data
        if not props.get('_enriched_fee') or props.get('_enriched_fee') == 'Varies':
            url = props.get('website') or props.get('url') or props.get('contact:website')
            if url:
                to_scrape.append((i, url))

    print(f"Enriched {enriched_from_props} from existing properties")
    print(f"Queuing {len(to_scrape)} sites for web scraping...")

    # Scrape in parallel with rate limiting
    scraped = 0
    failed = 0
    enriched_from_web = 0

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {}
        for idx, url in to_scrape:
            is_doc = 'doc.govt.nz' in url
            fn = scrape_doc_site if is_doc else scrape_site
            futures[executor.submit(fn, url)] = idx

        for future in as_completed(futures):
            idx = futures[future]
            result = future.result()
            scraped += 1

            if result['success']:
                props = features[idx]['properties']

                if result['prices']:
                    price_str = format_price_range(result['prices'])
                    if price_str:
                        props['_enriched_fee'] = price_str
                        enriched_from_web += 1

                if result['hours'] and not props.get('opening_hours'):
                    props['_enriched_hours'] = result['hours']
            else:
                failed += 1

            if scraped % 50 == 0:
                print(f"  Scraped {scraped}/{len(to_scrape)} ({failed} failed, {enriched_from_web} enriched)")

    # Final stats
    total_with_fee = sum(1 for f in features if f['properties'].get('_enriched_fee') or f['properties'].get('charge') or f['properties'].get('fee') == 'no')
    total_with_hours = sum(1 for f in features if f['properties'].get('_enriched_hours') or f['properties'].get('opening_hours'))

    print(f"\n=== Results ===")
    print(f"Total campsites: {len(features)}")
    print(f"With fee data: {total_with_fee} ({100*total_with_fee/len(features):.0f}%)")
    print(f"With hours data: {total_with_hours} ({100*total_with_hours/len(features):.0f}%)")
    print(f"Enriched from properties: {enriched_from_props}")
    print(f"Enriched from web: {enriched_from_web}")
    print(f"Scrape failures: {failed}")

    # Write enriched data
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(data, f)
    print(f"\nWritten to {OUTPUT_FILE}")


if __name__ == '__main__':
    enrich_geojson()
