/* ===== Data Loader — Static GeoJSON Files ===== */
const DataLoader = {
  cache: {},

  async loadJSON(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to load ${url}: ${resp.status}`);
    return resp.json();
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
  }
};
