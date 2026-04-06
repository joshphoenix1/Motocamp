/* ===== Overpass API Loader — Viewport-driven POI fetching with IndexedDB cache ===== */
const OverpassLoader = {
  DB_NAME: 'motorcamp-poi-cache',
  DB_VERSION: 1,
  CACHE_TTL: 7 * 24 * 60 * 60 * 1000, // 7 days
  GRID_SIZE: 1.0, // degrees — cache grid granularity
  ENDPOINTS: [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
  ],
  _endpointIdx: 0,
  _db: null,
  _pending: new Set(), // track in-flight cell keys to avoid duplicate requests
  _listeners: [],

  // POI categories with Overpass queries
  categories: {
    campsites: {
      label: 'Campsites',
      query: '(node["tourism"="camp_site"]({{bbox}});way["tourism"="camp_site"]({{bbox}});node["tourism"="caravan_site"]({{bbox}});way["tourism"="caravan_site"]({{bbox}}););out center body;',
      icon: 'campground',
      markerType: 'campsite',
    },
    fuel: {
      label: 'Fuel Stations',
      query: '(node["amenity"="fuel"]({{bbox}});way["amenity"="fuel"]({{bbox}}););out center body;',
      icon: 'gas-pump',
      markerType: 'fuel',
    },
    water: {
      label: 'Drinking Water',
      query: '(node["amenity"="drinking_water"]({{bbox}});node["natural"="spring"]["drinking_water"="yes"]({{bbox}}););out center body;',
      icon: 'droplet',
      markerType: 'water',
    },
    toilets: {
      label: 'Toilets',
      query: '(node["amenity"="toilets"]({{bbox}});way["amenity"="toilets"]({{bbox}}););out center body;',
      icon: 'toilet',
      markerType: 'toilet',
    },
    shops: {
      label: 'Shops',
      query: '(node["shop"="supermarket"]({{bbox}});node["shop"="convenience"]({{bbox}});way["shop"="supermarket"]({{bbox}}););out center body;',
      icon: 'store',
      markerType: 'shop',
    },
    shelters: {
      label: 'Shelters',
      query: '(node["amenity"="shelter"]({{bbox}});node["tourism"="wilderness_hut"]({{bbox}});way["tourism"="wilderness_hut"]({{bbox}}););out center body;',
      icon: 'house',
      markerType: 'shelter',
    },
    dumpStations: {
      label: 'Dump Stations',
      query: '(node["amenity"="sanitary_dump_station"]({{bbox}});way["amenity"="sanitary_dump_station"]({{bbox}}););out center body;',
      icon: 'trailer',
      markerType: 'dump',
    },
    repairs: {
      label: 'Repair / Mechanics',
      query: '(node["amenity"="car_repair"]({{bbox}});node["shop"="motorcycle"]({{bbox}});node["shop"="car_repair"]({{bbox}});way["amenity"="car_repair"]({{bbox}}););out center body;',
      icon: 'wrench',
      markerType: 'repair',
    },
    picnicSites: {
      label: 'Picnic Sites',
      query: '(node["tourism"="picnic_site"]({{bbox}});way["tourism"="picnic_site"]({{bbox}}););out center body;',
      icon: 'utensils',
      markerType: 'picnic',
    },
    viewpoints: {
      label: 'Viewpoints',
      query: '(node["tourism"="viewpoint"]({{bbox}}););out center body;',
      icon: 'binoculars',
      markerType: 'viewpoint',
    },
    passes: {
      label: 'Mountain Passes',
      query: '(node["mountain_pass"="yes"]({{bbox}});node["natural"="saddle"]({{bbox}}););out center body;',
      icon: 'mountain',
      markerType: 'pass',
    },
    accommodation: {
      label: 'Hostels & Lodges',
      query: '(node["tourism"="hostel"]({{bbox}});node["tourism"="alpine_hut"]({{bbox}});way["tourism"="hostel"]({{bbox}});way["tourism"="alpine_hut"]({{bbox}}););out center body;',
      icon: 'bed',
      markerType: 'accommodation',
    },
    hospitals: {
      label: 'Hospitals & Clinics',
      query: '(node["amenity"="hospital"]({{bbox}});way["amenity"="hospital"]({{bbox}});node["amenity"="clinic"]({{bbox}});way["amenity"="clinic"]({{bbox}}););out center body;',
      icon: 'hospital',
      markerType: 'hospital',
    },
    atms: {
      label: 'ATMs & Banks',
      query: '(node["amenity"="atm"]({{bbox}});node["amenity"="bank"]({{bbox}});way["amenity"="bank"]({{bbox}}););out center body;',
      icon: 'money-bill-wave',
      markerType: 'atm',
    },
    borderCrossings: {
      label: 'Border Crossings',
      query: '(node["barrier"="border_control"]({{bbox}});way["barrier"="border_control"]({{bbox}}););out center body;',
      icon: 'passport',
      markerType: 'border',
    },
    restAreas: {
      label: 'Rest Areas',
      query: '(node["highway"="rest_area"]({{bbox}});way["highway"="rest_area"]({{bbox}});node["highway"="services"]({{bbox}});way["highway"="services"]({{bbox}}););out center body;',
      icon: 'square-parking',
      markerType: 'restarea',
    },
    fords: {
      label: 'Fords & River Crossings',
      query: '(node["ford"="yes"]({{bbox}});way["ford"="yes"]({{bbox}}););out center body;',
      icon: 'water',
      markerType: 'ford',
    },
    ferries: {
      label: 'Ferry Terminals',
      query: '(node["amenity"="ferry_terminal"]({{bbox}});way["amenity"="ferry_terminal"]({{bbox}}););out center body;',
      icon: 'ship',
      markerType: 'ferry',
    },
    waterSources: {
      label: 'Springs & Wells',
      query: '(node["natural"="spring"]({{bbox}});node["man_made"="water_well"]({{bbox}}););out center body;',
      icon: 'faucet-drip',
      markerType: 'spring',
    },
    embassies: {
      label: 'Embassies & Consulates',
      query: '(node["office"="diplomatic"]({{bbox}});way["office"="diplomatic"]({{bbox}}););out center body;',
      icon: 'building-flag',
      markerType: 'embassy',
    },
  },

  // ===== IndexedDB =====

  async openDB() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('tiles')) {
          db.createObjectStore('tiles');
        }
      };
      req.onsuccess = (e) => { this._db = e.target.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },

  async getCached(key) {
    const db = await this.openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('tiles', 'readonly');
      const req = tx.objectStore('tiles').get(key);
      req.onsuccess = () => {
        const val = req.result;
        if (val && Date.now() - val.ts < this.CACHE_TTL) {
          resolve(val.data);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  },

  async putCache(key, data) {
    const db = await this.openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('tiles', 'readwrite');
      tx.objectStore('tiles').put({ data, ts: Date.now() }, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  },

  // ===== Grid cells =====

  // Convert a bbox to grid cell keys that cover it
  bboxToCells(south, west, north, east) {
    const g = this.GRID_SIZE;
    const cells = [];
    const s = Math.floor(south / g) * g;
    const w = Math.floor(west / g) * g;
    for (let lat = s; lat < north; lat += g) {
      for (let lon = w; lon < east; lon += g) {
        cells.push({
          key: `${lat.toFixed(1)},${lon.toFixed(1)}`,
          south: lat,
          west: lon,
          north: lat + g,
          east: lon + g,
        });
      }
    }
    return cells;
  },

  // ===== Overpass fetch =====

  async fetchOverpass(query) {
    const endpoint = this.ENDPOINTS[this._endpointIdx % this.ENDPOINTS.length];
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent('[out:json][timeout:25];' + query),
      });
      if (resp.status === 429 || resp.status >= 500) {
        // Try next endpoint
        this._endpointIdx++;
        const fallback = this.ENDPOINTS[this._endpointIdx % this.ENDPOINTS.length];
        const resp2 = await fetch(fallback, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent('[out:json][timeout:25];' + query),
        });
        if (!resp2.ok) return [];
        const data = await resp2.json();
        return data.elements || [];
      }
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.elements || [];
    } catch (e) {
      console.warn('Overpass fetch failed:', e);
      return [];
    }
  },

  // Convert Overpass elements to GeoJSON features
  toGeoJSON(elements) {
    const features = [];
    for (const el of elements) {
      let lat, lon;
      if (el.type === 'node') {
        lat = el.lat; lon = el.lon;
      } else if (el.center) {
        lat = el.center.lat; lon = el.center.lon;
      } else {
        continue;
      }
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: { ...el.tags, _osm_id: el.id, _osm_type: el.type },
      });
    }
    return features;
  },

  // ===== Main entry: load a category for a map bbox =====

  async loadCategory(category, south, west, north, east) {
    const cat = this.categories[category];
    if (!cat) return [];

    const cells = this.bboxToCells(south, west, north, east);
    const allFeatures = [];
    const fetchPromises = [];

    for (const cell of cells) {
      const cacheKey = `${category}:${cell.key}`;

      // Skip if already in-flight
      if (this._pending.has(cacheKey)) continue;

      // Check cache first
      const cached = await this.getCached(cacheKey);
      if (cached) {
        allFeatures.push(...cached);
        continue;
      }

      // Need to fetch
      this._pending.add(cacheKey);
      const bbox = `${cell.south},${cell.west},${cell.north},${cell.east}`;
      const query = cat.query.replace(/\{\{bbox\}\}/g, bbox);

      fetchPromises.push(
        this.fetchOverpass(query).then(elements => {
          const features = this.toGeoJSON(elements);
          this.putCache(cacheKey, features);
          allFeatures.push(...features);
          this._pending.delete(cacheKey);
        }).catch(() => {
          this._pending.delete(cacheKey);
        })
      );
    }

    // Fetch uncached cells (max 3 concurrent to be polite to Overpass)
    const BATCH = 3;
    for (let i = 0; i < fetchPromises.length; i += BATCH) {
      await Promise.all(fetchPromises.slice(i, i + BATCH));
    }

    return allFeatures;
  },

  // ===== Viewport integration =====

  _debounceTimers: {},
  _activeCategories: new Set(),
  _map: null,

  // Call this once to wire up the map
  init(map) {
    this._map = map;
    map.on('moveend', () => this._onMapMove());
  },

  // Enable/disable a category for viewport loading
  enableCategory(category) {
    this._activeCategories.add(category);
    this._loadVisible(category);
  },

  disableCategory(category) {
    this._activeCategories.delete(category);
  },

  onData(callback) {
    this._listeners.push(callback);
  },

  _onMapMove() {
    // Debounce: only fetch 600ms after map stops moving
    for (const cat of this._activeCategories) {
      clearTimeout(this._debounceTimers[cat]);
      this._debounceTimers[cat] = setTimeout(() => this._loadVisible(cat), 600);
    }
  },

  async _loadVisible(category) {
    if (!this._map) return;

    // Only fetch if zoomed in enough (zoom >= 8) to keep queries reasonable
    const zoom = this._map.getZoom();
    if (zoom < 8) return;

    const b = this._map.getBounds();
    // Pad the bbox slightly so data is ready when user pans a bit
    const pad = 0.2;
    const features = await this.loadCategory(
      category,
      b.getSouth() - pad,
      b.getWest() - pad,
      b.getNorth() + pad,
      b.getEast() + pad
    );

    // Notify listeners
    for (const fn of this._listeners) {
      fn(category, features);
    }
  },

  // Clear all cached data
  async clearCache() {
    const db = await this.openDB();
    const tx = db.transaction('tiles', 'readwrite');
    tx.objectStore('tiles').clear();
    console.log('[OverpassLoader] Cache cleared');
  },
};
