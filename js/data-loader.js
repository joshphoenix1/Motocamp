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

  async loadDOCHuts() {
    try {
      const data = await this.loadJSON('data/doc-huts.geojson');
      console.log(`Loaded ${data.features?.length || 0} DOC huts`);
      return data;
    } catch (e) {
      console.warn('Failed to load DOC huts:', e);
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

  // Cell towers — generated client-side (no external API needed)
  async loadCellTowers() {
    return this.generateNZCellTowers();
  },

  // Generate representative NZ cell tower data based on known coverage
  generateNZCellTowers() {
    const towers = [];
    const carriers = [
      { name: 'Spark', mnc: '05' },
      { name: 'Vodafone', mnc: '01' },
      { name: '2degrees', mnc: '24' }
    ];

    const coveragePoints = [
      { lat: -36.8485, lon: 174.7633, name: 'Auckland', density: 'urban' },
      { lat: -36.7880, lon: 174.7562, name: 'North Shore', density: 'urban' },
      { lat: -36.9109, lon: 174.8794, name: 'Manukau', density: 'urban' },
      { lat: -37.7870, lon: 175.2793, name: 'Hamilton', density: 'urban' },
      { lat: -37.6878, lon: 176.1651, name: 'Tauranga', density: 'urban' },
      { lat: -38.1368, lon: 176.2497, name: 'Rotorua', density: 'urban' },
      { lat: -38.6857, lon: 176.0702, name: 'Taupo', density: 'town' },
      { lat: -39.0556, lon: 174.0752, name: 'New Plymouth', density: 'urban' },
      { lat: -39.4928, lon: 176.9120, name: 'Napier', density: 'urban' },
      { lat: -39.6382, lon: 176.8492, name: 'Hastings', density: 'urban' },
      { lat: -40.3523, lon: 175.6082, name: 'Palmerston North', density: 'urban' },
      { lat: -41.2865, lon: 174.7762, name: 'Wellington', density: 'urban' },
      { lat: -41.2082, lon: 174.9081, name: 'Lower Hutt', density: 'urban' },
      { lat: -39.9307, lon: 175.0479, name: 'Whanganui', density: 'town' },
      { lat: -35.7275, lon: 174.3239, name: 'Whangarei', density: 'urban' },
      { lat: -35.2820, lon: 174.0794, name: 'Kaikohe', density: 'rural' },
      { lat: -35.1142, lon: 174.0880, name: 'Kaitaia', density: 'rural' },
      { lat: -37.9841, lon: 176.8333, name: 'Whakatane', density: 'town' },
      { lat: -38.3620, lon: 175.7713, name: 'Tokoroa', density: 'town' },
      { lat: -38.6657, lon: 178.0231, name: 'Gisborne', density: 'town' },
      { lat: -40.9506, lon: 175.6589, name: 'Masterton', density: 'town' },
      { lat: -43.5321, lon: 172.6362, name: 'Christchurch', density: 'urban' },
      { lat: -45.8788, lon: 170.5028, name: 'Dunedin', density: 'urban' },
      { lat: -46.4132, lon: 168.3538, name: 'Invercargill', density: 'urban' },
      { lat: -41.2706, lon: 173.2840, name: 'Nelson', density: 'urban' },
      { lat: -41.5134, lon: 173.9612, name: 'Blenheim', density: 'town' },
      { lat: -42.4504, lon: 171.2107, name: 'Greymouth', density: 'town' },
      { lat: -44.3904, lon: 171.2373, name: 'Timaru', density: 'town' },
      { lat: -45.0312, lon: 168.6626, name: 'Queenstown', density: 'town' },
      { lat: -44.6985, lon: 169.1320, name: 'Wanaka', density: 'town' },
      { lat: -42.7807, lon: 173.9560, name: 'Kaikoura', density: 'rural' },
      { lat: -43.7543, lon: 170.0984, name: 'Mt Cook Village', density: 'rural' },
      { lat: -44.6638, lon: 167.9250, name: 'Te Anau', density: 'rural' },
      { lat: -43.3094, lon: 172.0450, name: 'Arthurs Pass', density: 'rural' },
      { lat: -43.8795, lon: 169.0420, name: 'Haast', density: 'rural' },
      { lat: -42.4660, lon: 172.5900, name: 'Hanmer Springs', density: 'rural' },
      { lat: -45.4148, lon: 167.7181, name: 'Milford Sound', density: 'rural' },
      { lat: -45.0540, lon: 169.1900, name: 'Cromwell', density: 'rural' },
      { lat: -45.2408, lon: 169.3800, name: 'Alexandra', density: 'rural' },
      { lat: -41.7574, lon: 171.6000, name: 'Westport', density: 'town' },
      { lat: -36.3516, lon: 174.6577, name: 'SH1 Wellsford', density: 'highway' },
      { lat: -37.0425, lon: 175.3070, name: 'SH1 Huntly', density: 'highway' },
      { lat: -38.0100, lon: 175.5690, name: 'SH1 Tirau', density: 'highway' },
      { lat: -39.2800, lon: 175.7700, name: 'SH1 Taihape', density: 'highway' },
      { lat: -40.6810, lon: 175.3010, name: 'SH1 Levin', density: 'highway' },
      { lat: -42.2528, lon: 173.6700, name: 'SH1 Seddon', density: 'highway' },
      { lat: -43.0380, lon: 173.0600, name: 'SH1 Waipara', density: 'highway' },
      { lat: -44.7230, lon: 171.0540, name: 'SH1 Oamaru', density: 'highway' },
      { lat: -46.1490, lon: 168.9100, name: 'SH1 Gore', density: 'highway' },
    ];

    // Use seeded random for consistency
    let seed = 42;
    const seededRandom = () => {
      seed = (seed * 16807 + 0) % 2147483647;
      return seed / 2147483647;
    };

    for (const point of coveragePoints) {
      const towerCount = point.density === 'urban' ? 8 :
                         point.density === 'town' ? 4 :
                         point.density === 'highway' ? 2 : 2;
      const spread = point.density === 'urban' ? 0.03 :
                     point.density === 'town' ? 0.02 : 0.01;

      for (let i = 0; i < towerCount; i++) {
        for (const carrier of carriers) {
          if (carrier.name === '2degrees' && point.density === 'rural' && seededRandom() > 0.4) continue;

          const lat = point.lat + (seededRandom() - 0.5) * spread;
          const lon = point.lon + (seededRandom() - 0.5) * spread;
          const tech = point.density === 'urban' ? (seededRandom() > 0.3 ? '4G' : '5G') :
                       point.density === 'town' ? '4G' :
                       seededRandom() > 0.5 ? '4G' : '3G';

          towers.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: { carrier: carrier.name, mnc: carrier.mnc, technology: tech, location: point.name, subtype: 'tower' }
          });
        }
      }
    }

    console.log(`Generated ${towers.length} cell towers`);
    return { type: 'FeatureCollection', features: towers };
  },

  // Load all data in parallel
  async loadAll(progressCallback) {
    const tasks = [
      { key: 'docCampsites', fn: () => this.loadDOCCampsites(), label: 'DOC Campsites' },
      { key: 'docHuts', fn: () => this.loadDOCHuts(), label: 'DOC Huts' },
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
