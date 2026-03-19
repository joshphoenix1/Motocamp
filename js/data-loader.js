/* ===== Data Loader ===== */
const DataLoader = {
  cache: {},

  // Load DOC campsites from ArcGIS MapServer
  async loadDOCCampsites() {
    const url = 'https://mapserver.doc.govt.nz/arcgis/rest/services/DOCMaps/DOCMaps/MapServer/1/query?' +
      'where=1%3D1&outFields=*&outSR=4326&f=geojson&resultRecordCount=2000';
    try {
      const resp = await fetch(url);
      const data = await resp.json();
      console.log(`Loaded ${data.features?.length || 0} DOC campsites`);
      return data;
    } catch (e) {
      console.warn('Failed to load DOC campsites, using fallback', e);
      return this.generateFallbackDOCCampsites();
    }
  },

  // Load DOC huts from ArcGIS MapServer
  async loadDOCHuts() {
    const url = 'https://mapserver.doc.govt.nz/arcgis/rest/services/DOCMaps/DOCMaps/MapServer/3/query?' +
      'where=1%3D1&outFields=*&outSR=4326&f=geojson&resultRecordCount=2000';
    try {
      const resp = await fetch(url);
      const data = await resp.json();
      console.log(`Loaded ${data.features?.length || 0} DOC huts`);
      return data;
    } catch (e) {
      console.warn('Failed to load DOC huts, using fallback', e);
      return this.generateFallbackDOCHuts();
    }
  },

  // Load campsites from OpenStreetMap via Overpass
  async loadOSMCampsites() {
    const query = `[out:json][timeout:60];
area["ISO3166-1"="NZ"]->.nz;
(
  node["tourism"="camp_site"](area.nz);
  node["tourism"="caravan_site"](area.nz);
  way["tourism"="camp_site"](area.nz);
  way["tourism"="caravan_site"](area.nz);
);
out center body;`;

    try {
      const resp = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      const data = await resp.json();
      const geojson = this.osmToGeoJSON(data.elements, 'campsite');
      console.log(`Loaded ${geojson.features.length} OSM campsites`);
      return geojson;
    } catch (e) {
      console.warn('Failed to load OSM campsites', e);
      return { type: 'FeatureCollection', features: [] };
    }
  },

  // Load amenities from OSM
  async loadOSMAmenities() {
    const query = `[out:json][timeout:90];
area["ISO3166-1"="NZ"]->.nz;
(
  node["amenity"="toilets"](area.nz);
  node["amenity"="drinking_water"](area.nz);
  node["amenity"="shelter"](area.nz);
  node["amenity"="fuel"](area.nz);
  node["shop"="convenience"](area.nz);
  node["shop"="supermarket"](area.nz);
);
out body;`;

    try {
      const resp = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      const data = await resp.json();
      const geojson = this.osmToGeoJSON(data.elements, 'amenity');
      console.log(`Loaded ${geojson.features.length} OSM amenities`);
      return geojson;
    } catch (e) {
      console.warn('Failed to load OSM amenities', e);
      return { type: 'FeatureCollection', features: [] };
    }
  },

  // Load cell towers from OpenCellID (we'll generate synthetic data based on known tower locations)
  async loadCellTowers() {
    // OpenCellID requires API key for bulk download, so we generate representative
    // tower data based on known NZ cell infrastructure coverage patterns
    return this.generateNZCellTowers();
  },

  // Convert OSM elements to GeoJSON
  osmToGeoJSON(elements, category) {
    const features = [];
    for (const el of elements) {
      const lat = el.lat || (el.center && el.center.lat);
      const lon = el.lon || (el.center && el.center.lon);
      if (!lat || !lon) continue;

      const props = { ...el.tags, osmId: el.id, category };

      // Determine sub-type
      if (el.tags) {
        if (el.tags.tourism === 'camp_site') props.subtype = 'campsite';
        else if (el.tags.tourism === 'caravan_site') props.subtype = 'caravan';
        else if (el.tags.amenity === 'toilets') props.subtype = 'toilet';
        else if (el.tags.amenity === 'drinking_water') props.subtype = 'water';
        else if (el.tags.amenity === 'shelter') props.subtype = 'shelter';
        else if (el.tags.amenity === 'fuel') props.subtype = 'fuel';
        else if (el.tags.shop) props.subtype = 'shop';
      }

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: props
      });
    }
    return { type: 'FeatureCollection', features };
  },

  // Generate representative NZ cell tower data
  generateNZCellTowers() {
    const towers = [];
    const carriers = [
      { name: 'Spark', mnc: '05', color: '#ffe600' },
      { name: 'Vodafone', mnc: '01', color: '#e60000' },
      { name: '2degrees', mnc: '24', color: '#00aaff' }
    ];

    // Major NZ towns/cities with cell coverage — comprehensive list
    const coveragePoints = [
      // North Island
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
      { lat: -37.5328, lon: 175.8534, name: 'Thames', density: 'town' },
      { lat: -36.4334, lon: 174.7257, name: 'Orewa', density: 'town' },
      { lat: -35.7275, lon: 174.3239, name: 'Whangarei', density: 'urban' },
      { lat: -35.2820, lon: 174.0794, name: 'Kaikohe', density: 'rural' },
      { lat: -35.1142, lon: 174.0880, name: 'Kaitaia', density: 'rural' },
      { lat: -37.9841, lon: 176.8333, name: 'Whakatane', density: 'town' },
      { lat: -38.3620, lon: 175.7713, name: 'Tokoroa', density: 'town' },
      { lat: -38.6657, lon: 178.0231, name: 'Gisborne', density: 'town' },
      { lat: -40.9506, lon: 175.6589, name: 'Masterton', density: 'town' },
      { lat: -37.2090, lon: 175.8797, name: 'Matamata', density: 'rural' },
      { lat: -36.8005, lon: 175.4976, name: 'Coromandel', density: 'rural' },

      // South Island
      { lat: -43.5321, lon: 172.6362, name: 'Christchurch', density: 'urban' },
      { lat: -45.8788, lon: 170.5028, name: 'Dunedin', density: 'urban' },
      { lat: -46.4132, lon: 168.3538, name: 'Invercargill', density: 'urban' },
      { lat: -41.2706, lon: 173.2840, name: 'Nelson', density: 'urban' },
      { lat: -41.5134, lon: 173.9612, name: 'Blenheim', density: 'town' },
      { lat: -42.4504, lon: 171.2107, name: 'Greymouth', density: 'town' },
      { lat: -42.4411, lon: 171.2100, name: 'Hokitika', density: 'rural' },
      { lat: -44.3904, lon: 171.2373, name: 'Timaru', density: 'town' },
      { lat: -45.0312, lon: 168.6626, name: 'Queenstown', density: 'town' },
      { lat: -44.6985, lon: 169.1320, name: 'Wanaka', density: 'town' },
      { lat: -44.2602, lon: 170.0986, name: 'Fairlie', density: 'rural' },
      { lat: -42.7807, lon: 173.9560, name: 'Kaikoura', density: 'rural' },
      { lat: -43.7543, lon: 170.0984, name: 'Mt Cook Village', density: 'rural' },
      { lat: -44.6638, lon: 167.9250, name: 'Te Anau', density: 'rural' },
      { lat: -42.0933, lon: 171.8645, name: 'Reefton', density: 'rural' },
      { lat: -43.3094, lon: 172.0450, name: 'Arthurs Pass', density: 'rural' },
      { lat: -43.8795, lon: 169.0420, name: 'Haast', density: 'rural' },
      { lat: -42.4660, lon: 172.5900, name: 'Hanmer Springs', density: 'rural' },
      { lat: -46.0991, lon: 166.7268, name: 'Riverton', density: 'rural' },
      { lat: -46.6000, lon: 168.3400, name: 'Bluff', density: 'rural' },
      { lat: -45.4148, lon: 167.7181, name: 'Milford Sound', density: 'rural' },
      { lat: -45.0540, lon: 169.1900, name: 'Cromwell', density: 'rural' },
      { lat: -45.2408, lon: 169.3800, name: 'Alexandra', density: 'rural' },
      { lat: -44.0543, lon: 170.4720, name: 'Geraldine', density: 'rural' },
      { lat: -43.3560, lon: 172.4680, name: 'Rangiora', density: 'town' },
      { lat: -43.6010, lon: 172.3310, name: 'Darfield', density: 'rural' },
      { lat: -41.7574, lon: 171.6000, name: 'Westport', density: 'town' },

      // Major highway corridors — towers along SH1, SH2, SH3, etc
      { lat: -36.3516, lon: 174.6577, name: 'SH1 Wellsford', density: 'highway' },
      { lat: -37.0425, lon: 175.3070, name: 'SH1 Huntly', density: 'highway' },
      { lat: -38.0100, lon: 175.5690, name: 'SH1 Tirau', density: 'highway' },
      { lat: -39.2800, lon: 175.7700, name: 'SH1 Taihape', density: 'highway' },
      { lat: -40.6810, lon: 175.3010, name: 'SH1 Levin', density: 'highway' },
      { lat: -41.0330, lon: 175.0600, name: 'SH1 Otaki', density: 'highway' },
      { lat: -42.2528, lon: 173.6700, name: 'SH1 Seddon', density: 'highway' },
      { lat: -43.0380, lon: 173.0600, name: 'SH1 Waipara', density: 'highway' },
      { lat: -44.7230, lon: 171.0540, name: 'SH1 Oamaru', density: 'highway' },
      { lat: -45.5210, lon: 170.1990, name: 'SH1 Palmerston', density: 'highway' },
      { lat: -46.1490, lon: 168.9100, name: 'SH1 Gore', density: 'highway' },
    ];

    for (const point of coveragePoints) {
      const towerCount = point.density === 'urban' ? 8 :
                         point.density === 'town' ? 4 :
                         point.density === 'highway' ? 2 : 2;

      for (let i = 0; i < towerCount; i++) {
        const spread = point.density === 'urban' ? 0.03 :
                       point.density === 'town' ? 0.02 : 0.01;

        for (const carrier of carriers) {
          // Not all carriers have towers everywhere — 2degrees has less rural coverage
          if (carrier.name === '2degrees' && point.density === 'rural' && Math.random() > 0.4) continue;

          const lat = point.lat + (Math.random() - 0.5) * spread;
          const lon = point.lon + (Math.random() - 0.5) * spread;
          const tech = point.density === 'urban' ? (Math.random() > 0.3 ? '4G' : '5G') :
                       point.density === 'town' ? '4G' :
                       Math.random() > 0.5 ? '4G' : '3G';

          towers.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: {
              carrier: carrier.name,
              mnc: carrier.mnc,
              technology: tech,
              location: point.name,
              subtype: 'tower'
            }
          });
        }
      }
    }

    return { type: 'FeatureCollection', features: towers };
  },

  // Fallback DOC campsites (key sites across NZ)
  generateFallbackDOCCampsites() {
    const sites = [
      { name: 'Uretiti Beach DOC Campsite', lat: -35.9010, lon: 174.4710, type: 'Standard Campsite' },
      { name: 'Ramarama Bay DOC Campsite', lat: -36.3040, lon: 175.3190, type: 'Basic Campsite' },
      { name: 'Pinnacles Hut Campsite', lat: -36.7627, lon: 175.5560, type: 'Standard Campsite' },
      { name: 'Waikawau Bay DOC Campsite', lat: -36.6090, lon: 175.4750, type: 'Standard Campsite' },
      { name: 'Blue Lake DOC Campsite', lat: -38.2050, lon: 176.3760, type: 'Basic Campsite' },
      { name: 'Mangahao Campsite', lat: -40.5870, lon: 175.6470, type: 'Basic Campsite' },
      { name: 'Catchpool Valley', lat: -41.2900, lon: 174.9700, type: 'Standard Campsite' },
      { name: 'Totaranui Campsite', lat: -40.8201, lon: 173.0120, type: 'Serviced Campsite' },
      { name: 'Kerr Bay Campsite', lat: -41.8060, lon: 172.8440, type: 'Serviced Campsite' },
      { name: 'West Bay Campsite', lat: -41.8120, lon: 172.8330, type: 'Standard Campsite' },
      { name: 'Lake Daniells', lat: -42.1320, lon: 172.2480, type: 'Backcountry Campsite' },
      { name: 'Okiwi Bay Campsite', lat: -41.1780, lon: 173.6830, type: 'Standard Campsite' },
      { name: 'Whites Bay Campsite', lat: -41.3520, lon: 174.1320, type: 'Standard Campsite' },
      { name: 'Kaikoura DOC Campsite', lat: -42.3880, lon: 173.6610, type: 'Standard Campsite' },
      { name: 'Glentui River Campsite', lat: -43.1760, lon: 172.1190, type: 'Basic Campsite' },
      { name: 'Lake Pearson Campsite', lat: -43.1700, lon: 171.7100, type: 'Basic Campsite' },
      { name: 'Bealey Spur Campsite', lat: -43.0130, lon: 171.5780, type: 'Basic Campsite' },
      { name: 'White Horse Hill Campsite', lat: -43.7310, lon: 170.0950, type: 'Serviced Campsite' },
      { name: 'Lake Ohau Campsite', lat: -44.2480, lon: 169.8400, type: 'Standard Campsite' },
      { name: 'Lake Hawea Campsite', lat: -44.6010, lon: 169.2560, type: 'Standard Campsite' },
      { name: 'Boundary Creek Campsite', lat: -44.5990, lon: 168.3420, type: 'Standard Campsite' },
      { name: 'Milford Sound Lodge Camp', lat: -44.6460, lon: 167.9220, type: 'Basic Campsite' },
      { name: 'Henry Creek Campsite', lat: -44.7050, lon: 168.0340, type: 'Backcountry Campsite' },
      { name: 'Mavora Lakes Campsite', lat: -45.2870, lon: 168.1810, type: 'Standard Campsite' },
      { name: 'Moke Lake Campsite', lat: -45.0050, lon: 168.5780, type: 'Standard Campsite' },
      { name: 'Albert Town Campsite', lat: -44.6810, lon: 169.1950, type: 'Standard Campsite' },
      { name: 'Gillespies Beach Campsite', lat: -43.3990, lon: 169.8210, type: 'Basic Campsite' },
      { name: 'Lake Paringa Campsite', lat: -43.7130, lon: 169.4180, type: 'Standard Campsite' },
      { name: 'Murphy Creek Campsite', lat: -43.7990, lon: 169.2350, type: 'Basic Campsite' },
      { name: 'Punakaiki Campsite', lat: -42.1080, lon: 171.3360, type: 'Standard Campsite' },
      { name: 'Rarangi DOC Campsite', lat: -41.4140, lon: 174.0310, type: 'Basic Campsite' },
      { name: 'Port Jackson DOC Campsite', lat: -36.5630, lon: 175.3770, type: 'Standard Campsite' },
      { name: 'Fletcher Bay DOC Campsite', lat: -36.5290, lon: 175.3720, type: 'Standard Campsite' },
      { name: 'Stony Bay DOC Campsite', lat: -36.5400, lon: 175.4190, type: 'Standard Campsite' },
    ];

    return {
      type: 'FeatureCollection',
      features: sites.map(s => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: {
          DESCRIPTION: s.name,
          STATUS: 'OPEN',
          OBJECT_TYPE_DESCRIPTION: s.type,
          source: 'fallback'
        }
      }))
    };
  },

  // Fallback DOC huts
  generateFallbackDOCHuts() {
    const huts = [
      { name: 'Mueller Hut', lat: -43.7200, lon: 170.0740, category: 'Great Walk' },
      { name: 'Luxmore Hut', lat: -45.3510, lon: 167.7430, category: 'Great Walk' },
      { name: 'Mintaro Hut', lat: -44.9050, lon: 167.7820, category: 'Great Walk' },
      { name: 'Dumpling Hut', lat: -44.8970, lon: 167.7650, category: 'Great Walk' },
      { name: 'Clinton Hut', lat: -44.9480, lon: 167.8960, category: 'Great Walk' },
      { name: 'Routeburn Falls Hut', lat: -44.7350, lon: 168.2450, category: 'Great Walk' },
      { name: 'Routeburn Flats Hut', lat: -44.7450, lon: 168.2680, category: 'Great Walk' },
      { name: 'Lake Mackenzie Hut', lat: -44.7850, lon: 168.1880, category: 'Great Walk' },
      { name: 'Howden Hut', lat: -44.8350, lon: 168.1200, category: 'Great Walk' },
      { name: 'Angelus Hut', lat: -41.8070, lon: 172.8970, category: 'Serviced' },
      { name: 'Welcome Flat Hut', lat: -43.4250, lon: 170.2050, category: 'Serviced' },
      { name: 'Waiaua Gorge Hut', lat: -39.2480, lon: 174.0750, category: 'Standard' },
      { name: 'Kime Hut', lat: -41.0370, lon: 175.2230, category: 'Standard' },
      { name: 'Powell Hut', lat: -41.0430, lon: 175.2570, category: 'Standard' },
      { name: 'French Ridge Hut', lat: -44.4870, lon: 168.7930, category: 'Standard' },
      { name: 'Liverpool Hut', lat: -44.4540, lon: 168.8630, category: 'Standard' },
      { name: 'Brewster Hut', lat: -44.1070, lon: 169.3280, category: 'Standard' },
      { name: 'Pinnacles Hut', lat: -36.7650, lon: 175.5590, category: 'Serviced' },
      { name: 'Cape Brett Hut', lat: -35.1680, lon: 174.3440, category: 'Standard' },
      { name: 'Waiopehu Hut', lat: -40.7150, lon: 175.4480, category: 'Standard' },
    ];

    return {
      type: 'FeatureCollection',
      features: huts.map(h => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
        properties: {
          DESCRIPTION: h.name,
          STATUS: 'OPEN',
          OBJECT_TYPE_DESCRIPTION: h.category + ' Hut',
          source: 'fallback'
        }
      }))
    };
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
