/* ===== Offline Map Downloads — Region tile pre-fetcher ===== */
const OfflineMaps = {
  CACHE_NAME: 'motorcamp-tiles',
  TILE_URL: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  SUBDOMAINS: ['a', 'b', 'c'],
  MIN_ZOOM: 6,
  MAX_ZOOM: 13, // street-level detail without being excessive
  _downloading: false,
  _progress: { done: 0, total: 0, region: '' },
  _aborted: false,

  // Pre-defined regions with bbox [south, west, north, east]
  regions: {
    // USA
    'us-west':        { name: 'US West',              bbox: [31, -125, 49, -104],   est: '~180 MB' },
    'us-southwest':   { name: 'US Southwest',          bbox: [31, -118, 40, -104],   est: '~120 MB' },
    'us-rockies':     { name: 'US Rockies',            bbox: [37, -114, 49, -104],   est: '~100 MB' },
    'us-southeast':   { name: 'US Southeast',          bbox: [24, -92, 37, -75],     est: '~150 MB' },
    'us-northeast':   { name: 'US Northeast',          bbox: [37, -82, 47, -67],     est: '~80 MB' },
    // Europe
    'eu-alps':        { name: 'Alps (AT/CH/FR/IT)',    bbox: [44, 5, 48.5, 17],      est: '~100 MB' },
    'eu-scandinavia': { name: 'Scandinavia',           bbox: [55, 4, 71, 32],        est: '~150 MB' },
    'eu-iberia':      { name: 'Spain & Portugal',      bbox: [36, -10, 44, 4],       est: '~90 MB' },
    'eu-balkans':     { name: 'Balkans & Greece',      bbox: [35, 13, 47, 30],       est: '~100 MB' },
    'uk-ireland':     { name: 'UK & Ireland',          bbox: [50, -11, 59, 2],       est: '~60 MB' },
    // Africa
    'af-southern':    { name: 'Southern Africa',       bbox: [-35, 15, -15, 35],     est: '~120 MB' },
    'af-east':        { name: 'East Africa',           bbox: [-12, 28, 5, 42],       est: '~100 MB' },
    'af-morocco':     { name: 'Morocco',               bbox: [27, -13, 36, -1],      est: '~50 MB' },
    // Oceania
    'nz':             { name: 'New Zealand',           bbox: [-47, 166, -34, 179],   est: '~40 MB' },
    'au-outback':     { name: 'Australia (Outback)',   bbox: [-35, 125, -20, 145],   est: '~80 MB' },
    'au-east':        { name: 'Australia (East Coast)', bbox: [-38, 144, -16, 154],  est: '~90 MB' },
    // Americas
    'patagonia':      { name: 'Patagonia',             bbox: [-55, -76, -38, -63],   est: '~60 MB' },
    'baja':           { name: 'Baja California',       bbox: [23, -117, 33, -109],   est: '~40 MB' },
    'central-am':     { name: 'Central America',       bbox: [7, -92, 18, -77],      est: '~70 MB' },
    // Asia
    'asia-central':   { name: 'Central Asia',          bbox: [35, 50, 55, 80],       est: '~120 MB' },
    'asia-se':        { name: 'SE Asia',               bbox: [-10, 95, 24, 120],     est: '~150 MB' },
  },

  // Count tiles for a bbox at given zoom range
  countTiles(south, west, north, east, minZ, maxZ) {
    let total = 0;
    for (let z = minZ; z <= maxZ; z++) {
      const minX = this._lon2tile(west, z);
      const maxX = this._lon2tile(east, z);
      const minY = this._lat2tile(north, z); // note: north has smaller Y
      const maxY = this._lat2tile(south, z);
      total += (maxX - minX + 1) * (maxY - minY + 1);
    }
    return total;
  },

  // Download all tiles for a region
  async downloadRegion(regionId) {
    const region = this.regions[regionId];
    if (!region || this._downloading) return;

    const [south, west, north, east] = region.bbox;
    const total = this.countTiles(south, west, north, east, this.MIN_ZOOM, this.MAX_ZOOM);

    this._downloading = true;
    this._aborted = false;
    this._progress = { done: 0, total, region: region.name };
    this._updateUI();

    const cache = await caches.open(this.CACHE_NAME);
    const BATCH = 6; // concurrent downloads

    for (let z = this.MIN_ZOOM; z <= this.MAX_ZOOM; z++) {
      if (this._aborted) break;

      const minX = this._lon2tile(west, z);
      const maxX = this._lon2tile(east, z);
      const minY = this._lat2tile(north, z);
      const maxY = this._lat2tile(south, z);

      const tiles = [];
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          tiles.push({ z, x, y });
        }
      }

      // Fetch in batches
      for (let i = 0; i < tiles.length; i += BATCH) {
        if (this._aborted) break;

        const batch = tiles.slice(i, i + BATCH);
        await Promise.all(batch.map(async (t) => {
          const sub = this.SUBDOMAINS[Math.abs(t.x + t.y) % this.SUBDOMAINS.length];
          const url = this.TILE_URL.replace('{s}', sub).replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);

          try {
            // Skip if already cached
            const existing = await cache.match(url);
            if (existing) {
              this._progress.done++;
              return;
            }

            const resp = await fetch(url);
            if (resp.ok) {
              await cache.put(url, resp);
            }
          } catch (e) { /* skip failed tiles */ }
          this._progress.done++;
        }));

        this._updateUI();

        // Small delay to be respectful to tile servers
        await new Promise(r => setTimeout(r, 50));
      }
    }

    // Save download record
    this._saveRegionRecord(regionId);
    this._downloading = false;
    this._updateUI();
  },

  abort() {
    this._aborted = true;
  },

  // Delete cached tiles for a region
  async deleteRegion(regionId) {
    const region = this.regions[regionId];
    if (!region) return;

    const [south, west, north, east] = region.bbox;
    const cache = await caches.open(this.CACHE_NAME);
    let deleted = 0;

    for (let z = this.MIN_ZOOM; z <= this.MAX_ZOOM; z++) {
      const minX = this._lon2tile(west, z);
      const maxX = this._lon2tile(east, z);
      const minY = this._lat2tile(north, z);
      const maxY = this._lat2tile(south, z);

      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const sub = this.SUBDOMAINS[Math.abs(x + y) % this.SUBDOMAINS.length];
          const url = this.TILE_URL.replace('{s}', sub).replace('{z}', z).replace('{x}', x).replace('{y}', y);
          if (await cache.delete(url)) deleted++;
        }
      }
    }

    this._removeRegionRecord(regionId);
    console.log(`[Offline] Deleted ${deleted} tiles for ${region.name}`);
    this._updateUI();
  },

  // Track which regions are downloaded
  _saveRegionRecord(regionId) {
    const records = JSON.parse(localStorage.getItem('motorcamp-offline-regions') || '{}');
    records[regionId] = { downloadedAt: Date.now(), tiles: this._progress.total };
    localStorage.setItem('motorcamp-offline-regions', JSON.stringify(records));
  },

  _removeRegionRecord(regionId) {
    const records = JSON.parse(localStorage.getItem('motorcamp-offline-regions') || '{}');
    delete records[regionId];
    localStorage.setItem('motorcamp-offline-regions', JSON.stringify(records));
  },

  getDownloadedRegions() {
    return JSON.parse(localStorage.getItem('motorcamp-offline-regions') || '{}');
  },

  // Tile coordinate math
  _lon2tile(lon, zoom) { return Math.floor((lon + 180) / 360 * Math.pow(2, zoom)); },
  _lat2tile(lat, zoom) { return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)); },

  // UI updates
  _updateUI() {
    const el = document.getElementById('offline-status');
    if (!el) return;

    if (this._downloading) {
      const pct = this._progress.total > 0 ? Math.round(this._progress.done / this._progress.total * 100) : 0;
      el.innerHTML = `
        <div style="font-size:0.8rem;margin-bottom:6px">
          <strong>Downloading ${this._progress.region}...</strong> ${pct}%
        </div>
        <div style="height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:#00c853;transition:width 0.3s"></div>
        </div>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px">
          ${this._progress.done.toLocaleString()} / ${this._progress.total.toLocaleString()} tiles
          <button onclick="OfflineMaps.abort()" style="margin-left:8px;color:#ff5252;background:none;border:none;cursor:pointer;font-size:0.7rem">Cancel</button>
        </div>
      `;
    } else {
      el.innerHTML = '';
    }

    // Update region list
    this.renderRegionList();
  },

  renderRegionList() {
    const list = document.getElementById('offline-region-list');
    if (!list) return;

    const downloaded = this.getDownloadedRegions();
    const groups = {
      'North America': ['us-west', 'us-southwest', 'us-rockies', 'us-southeast', 'us-northeast', 'baja', 'central-am'],
      'Europe': ['uk-ireland', 'eu-alps', 'eu-scandinavia', 'eu-iberia', 'eu-balkans'],
      'Oceania': ['nz', 'au-outback', 'au-east'],
      'Africa': ['af-morocco', 'af-east', 'af-southern'],
      'South America': ['patagonia'],
      'Asia': ['asia-central', 'asia-se'],
    };

    let html = '';
    for (const [groupName, ids] of Object.entries(groups)) {
      html += `<div style="font-size:0.72rem;color:var(--text-muted);margin:10px 0 4px;text-transform:uppercase;letter-spacing:1px">${groupName}</div>`;
      for (const id of ids) {
        const r = this.regions[id];
        if (!r) continue;
        const dl = downloaded[id];
        const isDownloaded = !!dl;
        const dateStr = dl ? new Date(dl.downloadedAt).toLocaleDateString() : '';

        html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
          <div>
            <span style="font-size:0.82rem">${r.name}</span>
            <span style="font-size:0.68rem;color:var(--text-muted);margin-left:6px">${r.est}</span>
            ${isDownloaded ? `<span style="font-size:0.65rem;color:#00c853;margin-left:6px"><i class="fas fa-check"></i> ${dateStr}</span>` : ''}
          </div>
          <div>
            ${isDownloaded
              ? `<button onclick="OfflineMaps.deleteRegion('${id}')" style="font-size:0.7rem;color:#ff5252;background:none;border:1px solid rgba(255,82,82,0.3);border-radius:4px;padding:2px 8px;cursor:pointer"><i class="fas fa-trash"></i></button>`
              : `<button onclick="OfflineMaps.downloadRegion('${id}')" style="font-size:0.7rem;color:#00c853;background:none;border:1px solid rgba(0,200,83,0.3);border-radius:4px;padding:2px 8px;cursor:pointer" ${this._downloading ? 'disabled' : ''}><i class="fas fa-download"></i> Download</button>`
            }
          </div>
        </div>`;
      }
    }

    list.innerHTML = html;
  },

  init() {
    this.renderRegionList();
  },
};
