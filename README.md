# ABQ House Map

Interactive 3D map of 43 active 3-bedroom listings in Albuquerque, NM ($220K–$260K),
plus nearby supermarkets. Built for Julio's rental-investment research.

- 🗺️ Cartoon basemap (OpenFreeMap Liberty) + satellite toggle (Esri)
- 🧊 3D buildings, tilt/pitch navigation (MapLibre GL JS)
- 🏠 Clickable house pins colored by score (amenities + trend + safety, /21)
- 🛒 41 supermarket/grocery markers (toggleable)
- 🔎 Search addresses, streets, stores · filters by score, neighborhood, condos

## Data
- `data/listings.json` — 43 listings, geocoded Oct 11, 2026 (SWMLS feed Oct 10, 2026 8:59 PM MDT)
- `data/supermarkets.json` — OpenStreetMap supermarkets/grocery in the ABQ metro

## Run
Open `index.html` in a browser (use a local server, e.g. `python3 -m http.server`,
because `fetch()` needs http). No build step, no API keys.

## Credits
MapLibre GL JS (BSD-3), OpenFreeMap vector tiles, Esri World Imagery.
Listing data: SWMLS via nmwelcomehome.com.
