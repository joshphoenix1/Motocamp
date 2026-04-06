/* ===== Data Loader — Static GeoJSON with Cache API ===== */
const DataLoader = {
  cache: {},
  CACHE_NAME: 'lwh-data-v1',
  CACHE_TTL: 24 * 60 * 60 * 1000, // 24 hours

  async loadJSON(url) {
    // Try Cache API first for instant load
    try {
      const cache = await caches.open(this.CACHE_NAME);
      const cached = await cache.match(url);

      if (cached) {
        const age = Date.now() - new Date(cached.headers.get('x-cached-at') || 0).getTime();
        if (age < this.CACHE_TTL) {
          console.log(`[Cache HIT] ${url}`);
          return cached.json();
        }
      }

      // Fetch fresh and cache
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Failed to load ${url}: ${resp.status}`);

      const data = await resp.json();

      // Store in cache with timestamp
      const headers = new Headers({ 'Content-Type': 'application/json', 'x-cached-at': new Date().toISOString() });
      const cacheResp = new Response(JSON.stringify(data), { headers });
      await cache.put(url, cacheResp);
      console.log(`[Cache STORE] ${url}`);

      return data;
    } catch (e) {
      // Fallback: direct fetch without caching
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Failed to load ${url}: ${resp.status}`);
      return resp.json();
    }
  },

  async loadDOCCampsites() {
    try {
      const data = await this.loadJSON('data/doc-campsites.geojson');
      console.log(`Loaded ${data.features?.length || 0} DOC campsites`);
      return data;
    } catch (e) {
      console.warn('Failed to load DOC campsites:', e);
      return { type: 'FeatureCollection', features: [] };
    }
  },

  async loadOSMCampsites() {
    try {
      const data = await this.loadJSON('data/osm-campsites.geojson');
      console.log(`Loaded ${data.features?.length || 0} OSM campsites`);
      return data;
    } catch (e) {
      console.warn('Failed to load OSM campsites:', e);
      return { type: 'FeatureCollection', features: [] };
    }
  },

  async loadOSMAmenities() {
    try {
      const data = await this.loadJSON('data/osm-amenities.geojson');
      console.log(`Loaded ${data.features?.length || 0} OSM amenities`);
      return data;
    } catch (e) {
      console.warn('Failed to load OSM amenities:', e);
      return { type: 'FeatureCollection', features: [] };
    }
  },

  async loadCellTowers() {
    try {
      const data = await this.loadJSON('data/cell-towers.geojson');
      console.log(`Loaded ${data.features?.length || 0} cell towers`);
      return data;
    } catch (e) {
      console.warn('Failed to load cell towers:', e);
      return { type: 'FeatureCollection', features: [] };
    }
  },

  // Load all data in parallel
  async loadAll(progressCallback) {
    const tasks = [
      { key: 'docCampsites', fn: () => this.loadDOCCampsites(), label: 'DOC Campsites' },
      { key: 'osmCampsites', fn: () => this.loadOSMCampsites(), label: 'Holiday Parks' },
      { key: 'osmAmenities', fn: () => this.loadOSMAmenities(), label: 'Services' },
      { key: 'cellTowers', fn: () => this.loadCellTowers(), label: 'Cell Towers' },
    ];

    let done = 0;
    const results = {};

    await Promise.all(tasks.map(async task => {
      try {
        results[task.key] = await task.fn();
      } catch (e) {
        console.error(`Error loading ${task.label}:`, e);
        results[task.key] = { type: 'FeatureCollection', features: [] };
      }
      done++;
      if (progressCallback) progressCallback(done / tasks.length, task.label);
    }));

    this.cache = results;
    return results;
  },

  // Clear cache (for data updates)
  async clearCache() {
    await caches.delete(this.CACHE_NAME);
    if (typeof OverpassLoader !== 'undefined') OverpassLoader.clearCache();
    console.log('[Cache CLEARED]');
  }
};
