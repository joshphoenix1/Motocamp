/* ===== Road Surface Overlay — Color roads by surface type ===== */
const SurfaceOverlay = {
  _map: null,
  _layer: null,
  _enabled: false,
  _loadedCells: new Set(),
  _debounceTimer: null,
  GRID_SIZE: 0.5, // degrees — smaller grid for denser road data
  MIN_ZOOM: 10,   // only show when zoomed in enough

  SURFACE_COLORS: {
    // Paved
    asphalt:    { color: '#4caf50', weight: 2, opacity: 0.5, label: 'Asphalt' },
    concrete:   { color: '#4caf50', weight: 2, opacity: 0.5, label: 'Concrete' },
    paved:      { color: '#4caf50', weight: 2, opacity: 0.4, label: 'Paved' },
    // Good unpaved
    compacted:  { color: '#ffab40', weight: 2.5, opacity: 0.6, label: 'Compacted' },
    fine_gravel: { color: '#ffab40', weight: 2.5, opacity: 0.6, label: 'Fine gravel' },
    // Gravel
    gravel:     { color: '#ff9800', weight: 3, opacity: 0.65, label: 'Gravel' },
    pebblestone: { color: '#ff9800', weight: 3, opacity: 0.65, label: 'Pebblestone' },
    // Rough
    unpaved:    { color: '#ff5722', weight: 3, opacity: 0.65, label: 'Unpaved' },
    dirt:       { color: '#e64a19', weight: 3, opacity: 0.7, label: 'Dirt' },
    earth:      { color: '#e64a19', weight: 3, opacity: 0.7, label: 'Earth' },
    ground:     { color: '#e64a19', weight: 3, opacity: 0.7, label: 'Ground' },
    grass:      { color: '#8bc34a', weight: 2.5, opacity: 0.5, label: 'Grass' },
    // Extreme
    mud:        { color: '#d32f2f', weight: 3.5, opacity: 0.75, label: 'Mud' },
    sand:       { color: '#ff8f00', weight: 3.5, opacity: 0.75, label: 'Sand' },
    rock:       { color: '#d32f2f', weight: 3.5, opacity: 0.75, label: 'Rock' },
  },

  // Tracktype grades (when surface isn't specified)
  GRADE_COLORS: {
    grade1: { color: '#66bb6a', weight: 2, opacity: 0.45, label: 'Grade 1 (solid)' },
    grade2: { color: '#ffab40', weight: 2.5, opacity: 0.55, label: 'Grade 2 (gravel)' },
    grade3: { color: '#ff9800', weight: 3, opacity: 0.6, label: 'Grade 3 (soft)' },
    grade4: { color: '#ff5722', weight: 3, opacity: 0.65, label: 'Grade 4 (rough)' },
    grade5: { color: '#d32f2f', weight: 3.5, opacity: 0.7, label: 'Grade 5 (extreme)' },
  },

  init(map) {
    this._map = map;
    this._layer = L.layerGroup();
  },

  enable() {
    if (!this._map) return;
    this._enabled = true;
    this._map.addLayer(this._layer);
    this._loadVisible();
    this._map.on('moveend', this._onMove, this);
    this._showLegend();
  },

  disable() {
    this._enabled = false;
    if (this._map) {
      this._map.removeLayer(this._layer);
      this._map.off('moveend', this._onMove, this);
    }
    this._hideLegend();
  },

  _onMove() {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._loadVisible(), 800);
  },

  async _loadVisible() {
    if (!this._enabled || !this._map) return;
    if (this._map.getZoom() < this.MIN_ZOOM) return;

    const b = this._map.getBounds();
    const pad = 0.05;
    const south = b.getSouth() - pad;
    const west = b.getWest() - pad;
    const north = b.getNorth() + pad;
    const east = b.getEast() + pad;

    // Grid cells
    const g = this.GRID_SIZE;
    const cells = [];
    for (let lat = Math.floor(south / g) * g; lat < north; lat += g) {
      for (let lon = Math.floor(west / g) * g; lon < east; lon += g) {
        const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
        if (!this._loadedCells.has(key)) {
          cells.push({ key, south: lat, west: lon, north: lat + g, east: lon + g });
        }
      }
    }

    if (cells.length === 0) return;

    // Fetch all cells
    for (const cell of cells) {
      this._loadedCells.add(cell.key);
      const bbox = `${cell.south},${cell.west},${cell.north},${cell.east}`;

      // Query roads with surface or tracktype tags
      const query = `(
        way["highway"]["surface"](${bbox});
        way["highway"="track"]["tracktype"](${bbox});
      );out geom;`;

      try {
        const elements = await this._fetchOverpass(query);
        this._renderRoads(elements);
      } catch (e) {
        this._loadedCells.delete(cell.key);
      }
    }
  },

  async _fetchOverpass(query) {
    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://lz4.overpass-api.de/api/interpreter',
    ];
    for (const ep of endpoints) {
      try {
        const resp = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent('[out:json][timeout:25];' + query),
        });
        if (!resp.ok) continue;
        const data = await resp.json();
        return data.elements || [];
      } catch (e) { continue; }
    }
    return [];
  },

  _renderRoads(elements) {
    for (const el of elements) {
      if (el.type !== 'way' || !el.geometry) continue;

      const coords = el.geometry.map(p => [p.lat, p.lon]);
      if (coords.length < 2) continue;

      const surface = el.tags?.surface;
      const tracktype = el.tags?.tracktype;

      // Get style from surface, fallback to tracktype
      let style = this.SURFACE_COLORS[surface];
      if (!style && tracktype) style = this.GRADE_COLORS[tracktype];
      if (!style) style = this.SURFACE_COLORS['unpaved']; // fallback

      const line = L.polyline(coords, {
        color: style.color,
        weight: style.weight,
        opacity: style.opacity,
        interactive: false,
      });

      this._layer.addLayer(line);
    }
  },

  _showLegend() {
    let legend = document.getElementById('surface-legend');
    if (legend) { legend.classList.remove('hidden'); return; }

    legend = document.createElement('div');
    legend.id = 'surface-legend';
    legend.style.cssText = 'position:fixed;bottom:16px;left:16px;background:rgba(10,15,26,0.92);border-radius:8px;padding:10px 14px;z-index:1000;font-size:0.72rem;backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.08);max-width:160px';

    legend.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px;color:#b0bec5">Road Surface</div>
      <div style="display:flex;align-items:center;gap:6px;margin:3px 0"><span style="width:20px;height:3px;background:#4caf50;border-radius:2px;display:inline-block"></span> Paved</div>
      <div style="display:flex;align-items:center;gap:6px;margin:3px 0"><span style="width:20px;height:3px;background:#ffab40;border-radius:2px;display:inline-block"></span> Compacted</div>
      <div style="display:flex;align-items:center;gap:6px;margin:3px 0"><span style="width:20px;height:3px;background:#ff9800;border-radius:2px;display:inline-block"></span> Gravel</div>
      <div style="display:flex;align-items:center;gap:6px;margin:3px 0"><span style="width:20px;height:3px;background:#e64a19;border-radius:2px;display:inline-block"></span> Dirt / Earth</div>
      <div style="display:flex;align-items:center;gap:6px;margin:3px 0"><span style="width:20px;height:3px;background:#d32f2f;border-radius:2px;display:inline-block"></span> Mud / Sand / Rock</div>
      <div style="font-size:0.65rem;color:#546e7a;margin-top:6px">Zoom in for detail</div>
    `;
    document.body.appendChild(legend);
  },

  _hideLegend() {
    const legend = document.getElementById('surface-legend');
    if (legend) legend.classList.add('hidden');
  },
};
