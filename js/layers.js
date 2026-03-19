/* ===== Layer Management ===== */
const Layers = {
  groups: {},
  map: null,
  activeWeatherType: null,

  init(map, data) {
    this.map = map;
    this.createCampsiteLayers(data);
    this.createAmenityLayers(data);
    this.createCellTowerLayers(data);
    this.setupToggles();
    this.setupFilters();
    this.setupWeatherControls();
    this.setupBasemapSelector();
  },

  createCampsiteLayers(data) {
    // DOC Campsites
    const docCampsiteGroup = L.markerClusterGroup({
      maxClusterRadius: 40,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: (cluster) => L.divIcon({
        html: `<div>${cluster.getChildCount()}</div>`,
        className: 'marker-cluster marker-cluster-doc',
        iconSize: [36, 36]
      })
    });

    if (data.docCampsites?.features) {
      for (const f of data.docCampsites.features) {
        const [lon, lat] = f.geometry.coordinates;
        const props = f.properties;
        const name = props.DESCRIPTION || props.name || 'DOC Campsite';
        const typeDesc = props.OBJECT_TYPE_DESCRIPTION || 'Standard Campsite';

        // Skip backcountry and Great Walk campsites — not vehicle accessible
        const typeLower = typeDesc.toLowerCase();
        if (typeLower.includes('backcountry') || typeLower.includes('great walk')) continue;

        const facilities = Utils.getFacilities(typeDesc);

        const marker = L.marker([lat, lon], {
          icon: Utils.createMarker('campsite', 'campground')
        });

        marker.facilityData = { ...facilities, typeDesc, name };
        marker.on('click', () => this.showCampsiteInfo(name, typeDesc, facilities, props, lat, lon));
        docCampsiteGroup.addLayer(marker);
      }
    }
    this.groups['doc-campsites'] = docCampsiteGroup;
    this.map.addLayer(docCampsiteGroup);

    // OSM Campsites (commercial and freedom)
    const commercialGroup = L.markerClusterGroup({ maxClusterRadius: 35 });
    const freedomGroup = L.markerClusterGroup({ maxClusterRadius: 30 });

    if (data.osmCampsites?.features) {
      for (const f of data.osmCampsites.features) {
        const [lon, lat] = f.geometry.coordinates;
        const props = f.properties;
        const name = props.name || 'Campsite';

        // Skip backcountry / no vehicle access sites
        if (props.backcountry === 'yes' || props.access === 'no') continue;

        // Determine if commercial or freedom camping
        const isFreedom = props.fee === 'no' ||
                         (name.toLowerCase().includes('freedom') || name.toLowerCase().includes('free camp'));

        const marker = L.marker([lat, lon], {
          icon: Utils.createMarker(isFreedom ? 'freedom' : 'commercial',
                                   isFreedom ? 'tree' : 'caravan')
        });

        const facilities = {
          toilets: props.toilets === 'yes',
          water: props.drinking_water === 'yes',
          showers: props.shower === 'yes',
          power: props.power_supply === 'yes',
          kitchen: props.kitchen === 'yes',
          bbq: props.bbq === 'yes',
          wifi: props.internet_access === 'yes' || props.internet_access === 'wlan',
          laundry: props.washing_machine === 'yes',
          dump: props.sanitary_dump_station === 'yes',
          dogs: props.dog === 'yes',
          fee: props.fee === 'no' ? 'Free' : (props.charge || 'Varies'),
          feeLevel: props.fee === 'no' ? 'free' : 'paid',
        };

        marker.facilityData = { ...facilities, name, typeDesc: isFreedom ? 'Freedom Camping' : 'Holiday Park' };

        marker.on('click', () => this.showCampsiteInfo(
          name,
          isFreedom ? 'Freedom Camping' : 'Holiday Park / Campground',
          facilities,
          props,
          lat, lon
        ));

        if (isFreedom) {
          freedomGroup.addLayer(marker);
        } else {
          commercialGroup.addLayer(marker);
        }
      }
    }

    this.groups['commercial-camps'] = commercialGroup;
    this.groups['freedom-camps'] = freedomGroup;
    this.map.addLayer(commercialGroup);
    // Freedom camps off by default
  },

  createAmenityLayers(data) {
    const amenityGroups = {
      toilets: { group: L.markerClusterGroup({ maxClusterRadius: 30, disableClusteringAtZoom: 14 }), icon: 'toilet', type: 'toilet' },
      water: { group: L.markerClusterGroup({ maxClusterRadius: 30, disableClusteringAtZoom: 14 }), icon: 'droplet', type: 'water' },
      shelters: { group: L.markerClusterGroup({ maxClusterRadius: 30, disableClusteringAtZoom: 14 }), icon: 'house', type: 'shelter' },
      fuel: { group: L.markerClusterGroup({ maxClusterRadius: 30, disableClusteringAtZoom: 13 }), icon: 'gas-pump', type: 'fuel' },
      shops: { group: L.markerClusterGroup({ maxClusterRadius: 30, disableClusteringAtZoom: 13 }), icon: 'store', type: 'shop' },
    };

    if (data.osmAmenities?.features) {
      for (const f of data.osmAmenities.features) {
        const [lon, lat] = f.geometry.coordinates;
        const props = f.properties;
        const subtype = props.subtype;
        const name = props.name || subtype;

        let targetGroup;
        if (subtype === 'toilet') targetGroup = amenityGroups.toilets;
        else if (subtype === 'water') targetGroup = amenityGroups.water;
        else if (subtype === 'shelter') targetGroup = amenityGroups.shelters;
        else if (subtype === 'fuel') targetGroup = amenityGroups.fuel;
        else if (subtype === 'shop') targetGroup = amenityGroups.shops;

        if (targetGroup) {
          const marker = L.marker([lat, lon], {
            icon: Utils.createMarker(targetGroup.type, targetGroup.icon)
          });
          marker.bindPopup(`
            <div style="min-width:150px">
              <strong>${name}</strong><br>
              <span style="color:var(--text-muted);font-size:0.8em">${subtype}</span>
              ${props.operator ? `<br><span style="font-size:0.8em">Operator: ${props.operator}</span>` : ''}
              ${props.opening_hours ? `<br><span style="font-size:0.8em">Hours: ${props.opening_hours}</span>` : ''}
            </div>
          `);
          targetGroup.group.addLayer(marker);
        }
      }
    }

    for (const [key, val] of Object.entries(amenityGroups)) {
      this.groups[key] = val.group;
      // Amenities off by default
    }
  },

  createCellTowerLayers(data) {
    // Build heatmap data arrays per carrier
    const heatData = {
      'cell-spark': [],
      'cell-vodafone': [],
      'cell-2degrees': [],
    };

    if (data.cellTowers?.features) {
      for (const f of data.cellTowers.features) {
        const [lon, lat] = f.geometry.coordinates;
        const props = f.properties;

        // Intensity based on technology (newer = stronger signal area)
        const intensity = props.technology === '4G' ? 0.8 :
                          props.technology === '3G' ? 0.5 :
                          props.technology === '5G' ? 1.0 : 0.3;

        const key = props.carrier === 'Spark' ? 'cell-spark' :
                    props.carrier === 'One NZ' ? 'cell-vodafone' : 'cell-2degrees';

        if (heatData[key]) {
          heatData[key].push([lat, lon, intensity]);
        }
      }
    }

    // Carrier-specific color gradients
    const gradients = {
      'cell-spark': { 0.2: '#fff7cc', 0.4: '#ffee66', 0.6: '#ffe600', 0.8: '#ccb800', 1.0: '#998a00' },
      'cell-vodafone': { 0.2: '#ffcccc', 0.4: '#ff6666', 0.6: '#e60000', 0.8: '#b30000', 1.0: '#800000' },
      'cell-2degrees': { 0.2: '#ccedff', 0.4: '#66ccff', 0.6: '#00aaff', 0.8: '#0088cc', 1.0: '#006699' },
    };

    for (const [key, points] of Object.entries(heatData)) {
      const heat = L.heatLayer(points, {
        radius: 25,
        blur: 20,
        maxZoom: 12,
        max: 1.0,
        minOpacity: 0.15,
        gradient: gradients[key]
      });
      this.groups[key] = heat;
      this.map.addLayer(heat);
    }
  },

  setupToggles() {
    document.querySelectorAll('[data-layer]').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const layerKey = e.target.dataset.layer;
        const group = this.groups[layerKey];
        if (!group) return;

        if (e.target.checked) {
          this.map.addLayer(group);
        } else {
          this.map.removeLayer(group);
        }
      });
    });
  },

  setupFilters() {
    document.querySelectorAll('[data-filter]').forEach(checkbox => {
      checkbox.addEventListener('change', () => this.applyFilters());
    });
  },

  applyFilters() {
    const activeFilters = [];
    document.querySelectorAll('[data-filter]:checked').forEach(cb => {
      activeFilters.push(cb.dataset.filter);
    });

    if (activeFilters.length === 0) {
      // Show all markers
      for (const key of ['doc-campsites', 'commercial-camps', 'freedom-camps']) {
        const group = this.groups[key];
        if (!group) continue;
        group.eachLayer(marker => {
          if (marker.facilityData) marker.setOpacity(1);
        });
      }
      return;
    }

    for (const key of ['doc-campsites', 'commercial-camps', 'freedom-camps']) {
      const group = this.groups[key];
      if (!group) continue;

      group.eachLayer(marker => {
        if (!marker.facilityData) return;
        const fd = marker.facilityData;

        let match = true;
        for (const filter of activeFilters) {
          if (filter === 'free') {
            if (fd.feeLevel !== 'free') match = false;
          } else {
            if (!fd[filter]) match = false;
          }
        }

        marker.setOpacity(match ? 1 : 0.15);
      });
    }
  },

  setupWeatherControls() {
    document.querySelectorAll('[data-weather]').forEach(checkbox => {
      checkbox.addEventListener('change', async (e) => {
        const type = e.target.dataset.weather;

        // Uncheck others
        document.querySelectorAll('[data-weather]').forEach(cb => {
          if (cb !== e.target) cb.checked = false;
        });

        if (e.target.checked) {
          this.activeWeatherType = type;

          // Show loading
          if (!Weather.gridData) {
            const btn = e.target.closest('.layer-toggle');
            const origLabel = btn.querySelector('.toggle-label').textContent;
            btn.querySelector('.toggle-label').textContent = 'Loading weather...';
            await Weather.fetchGridWeather();
            btn.querySelector('.toggle-label').textContent = origLabel;
          }

          Weather.createOverlay(this.map, type, 0);

          // Show timeline and legend
          document.getElementById('weather-timeline').classList.remove('hidden');
          const legend = document.getElementById('weather-legend');
          const legendContent = document.getElementById('weather-legend-content');
          legendContent.innerHTML = Weather.buildLegendHTML(type);
          legend.classList.remove('hidden');
        } else {
          this.activeWeatherType = null;
          Weather.removeOverlay();
          Weather.stopAnimation();
          document.getElementById('weather-timeline').classList.add('hidden');
          document.getElementById('weather-legend').classList.add('hidden');
        }
      });
    });

    // Timeline slider
    const timelineSlider = document.getElementById('weather-timeline-slider');
    const sidebarSlider = document.getElementById('weather-time-slider');

    const onSliderChange = (val) => {
      const hour = parseInt(val);
      Weather.currentHourOffset = hour;
      if (this.activeWeatherType) {
        Weather.render();
      }
      Weather.updateTimeLabel(hour);
    };

    timelineSlider.addEventListener('input', (e) => {
      onSliderChange(e.target.value);
      sidebarSlider.value = e.target.value;
    });
    sidebarSlider.addEventListener('input', (e) => {
      onSliderChange(e.target.value);
      timelineSlider.value = e.target.value;
    });

    // Play button
    let playing = false;
    document.getElementById('weather-play').addEventListener('click', (e) => {
      playing = !playing;
      const btn = e.currentTarget;
      if (playing && this.activeWeatherType) {
        btn.innerHTML = '<i class="fas fa-pause"></i>';
        Weather.startAnimation(this.activeWeatherType);
      } else {
        btn.innerHTML = '<i class="fas fa-play"></i>';
        Weather.stopAnimation();
      }
    });
  },

  setupBasemapSelector() {
    const basemaps = {
      streets: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
      }),
      satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri',
        maxZoom: 18
      }),
      topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenTopoMap',
        maxZoom: 17
      })
    };

    // Remove only the initial tile layer added in app.js, not cluster layers
    if (window._initialTileLayer) {
      this.map.removeLayer(window._initialTileLayer);
      window._initialTileLayer = null;
    }
    let activeBasemap = basemaps.streets;
    this.map.addLayer(activeBasemap);
    activeBasemap.bringToBack();

    document.querySelectorAll('.basemap-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.basemap-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        this.map.removeLayer(activeBasemap);
        activeBasemap = basemaps[btn.dataset.basemap];
        this.map.addLayer(activeBasemap);
        activeBasemap.bringToBack();
      });
    });
  },

  async showCampsiteInfo(name, typeDesc, facilities, props, lat, lon) {
    const panel = document.getElementById('info-panel');
    const content = document.getElementById('info-content');

    const status = props.STATUS || props.status || 'OPEN';
    const isOpen = String(status).toUpperCase() === 'OPEN';

    // Build facility badges
    const facilityIcons = [
      { key: 'toilets', icon: 'toilet', label: 'Toilets' },
      { key: 'water', icon: 'droplet', label: 'Water' },
      { key: 'showers', icon: 'shower', label: 'Showers' },
      { key: 'power', icon: 'plug', label: 'Power' },
      { key: 'kitchen', icon: 'utensils', label: 'Kitchen' },
      { key: 'bbq', icon: 'fire', label: 'BBQ' },
      { key: 'wifi', icon: 'wifi', label: 'WiFi' },
      { key: 'laundry', icon: 'shirt', label: 'Laundry' },
      { key: 'dump', icon: 'trailer', label: 'Dump Station' },
      { key: 'rubbish', icon: 'trash', label: 'Rubbish' },
      { key: 'dogs', icon: 'dog', label: 'Dogs OK' },
    ];

    let facilityHTML = '';
    for (const fi of facilityIcons) {
      const val = facilities[fi.key];
      if (val === undefined) continue;
      const avail = val === true || val === 'yes' || (typeof val === 'string' && val !== 'no' && val !== false);
      facilityHTML += `<span class="facility-badge ${avail ? 'available' : ''}">
        <i class="fas fa-${fi.icon}"></i> ${fi.label}${typeof val === 'string' && val !== 'yes' && val !== 'no' ? ` (${val})` : ''}
      </span>`;
    }

    // Find nearby cell coverage
    const cellInfo = this.findCellCoverage(lat, lon);

    // Opening hours
    const hours = props.opening_hours || null;
    const isDOC = typeDesc.includes('Basic') || typeDesc.includes('Backcountry') || typeDesc.includes('Standard') || typeDesc.includes('Serviced') || typeDesc.includes('Great Walk') || typeDesc.includes('Scenic');
    const hoursHTML = hours
      ? `<div class="info-detail"><div class="info-detail-label">Opening Hours</div><div class="info-detail-value">${hours}</div></div>`
      : isDOC
        ? `<div class="info-detail"><div class="info-detail-label">Opening Hours</div><div class="info-detail-value" style="color:var(--accent)">Open 24/7</div></div>`
        : `<div class="info-detail"><div class="info-detail-label">Opening Hours</div><div class="info-detail-value">Check with operator</div></div>`;

    // Operator
    const operator = props.operator || (isDOC ? 'Department of Conservation (DOC)' : props.brand || '');

    // Capacity
    const capacity = props.capacity ? `<div class="info-detail"><div class="info-detail-label">Capacity</div><div class="info-detail-value">${props.capacity} sites</div></div>` : '';

    // Pets/dogs
    const pets = props.dog === 'yes' ? 'Dogs allowed' : props.dog === 'no' ? 'No dogs' : '';

    // Bookings
    const reservation = props.reservation || (typeDesc.includes('Great Walk') ? 'required' : typeDesc.includes('Serviced') ? 'recommended' : '');
    const reservationHTML = reservation ? `<div class="info-detail"><div class="info-detail-label">Bookings</div><div class="info-detail-value" style="text-transform:capitalize">${reservation}</div></div>` : '';

    // Nearby stats
    const nearbyStats = this.getNearbyStats(lat, lon);

    // Show panel immediately with placeholder for weather
    content.innerHTML = `
      <div class="info-header">
        <h2>${name}</h2>
        <span class="info-type">${typeDesc}</span>
        <span class="info-status ${isOpen ? 'open' : 'closed'}">${isOpen ? 'Open' : 'Closed'}</span>
      </div>

      ${operator ? `<div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:12px"><i class="fas fa-building" style="width:16px;color:var(--accent)"></i> ${operator}</div>` : ''}

      <div class="info-facilities">${facilityHTML}</div>

      <div class="info-details">
        <div class="info-detail">
          <div class="info-detail-label">Fee</div>
          <div class="info-detail-value">${facilities.fee || props.charge || props.fee || 'Check website'}</div>
        </div>
        ${hoursHTML}
        ${reservationHTML}
        ${capacity}
        ${pets ? `<div class="info-detail"><div class="info-detail-label">Pets</div><div class="info-detail-value">${pets}</div></div>` : ''}
        <div class="info-detail">
          <div class="info-detail-label">Coordinates</div>
          <div class="info-detail-value">${lat.toFixed(4)}, ${lon.toFixed(4)}</div>
        </div>
        ${facilities.description ? `
        <div class="info-detail" style="grid-column: 1 / -1">
          <div class="info-detail-label">Description</div>
          <div class="info-detail-value">${facilities.description}</div>
        </div>` : ''}
      </div>

      <div style="background:var(--bg-tertiary);border-radius:var(--radius);padding:12px;margin-bottom:16px">
        <h4 style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:8px"><i class="fas fa-map-signs" style="color:var(--accent)"></i> Nearby (within 20km)</h4>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <span class="facility-badge ${nearbyStats.campsites > 0 ? 'available' : ''}"><i class="fas fa-campground"></i> ${nearbyStats.campsites} Campsites</span>
          <span class="facility-badge ${nearbyStats.fuel > 0 ? 'available' : ''}"><i class="fas fa-gas-pump"></i> ${nearbyStats.fuel} Fuel</span>
          <span class="facility-badge ${nearbyStats.shops > 0 ? 'available' : ''}"><i class="fas fa-store"></i> ${nearbyStats.shops} Shops</span>
          <span class="facility-badge ${nearbyStats.water > 0 ? 'available' : ''}"><i class="fas fa-droplet"></i> ${nearbyStats.water} Water</span>
          <span class="facility-badge ${nearbyStats.toilets > 0 ? 'available' : ''}"><i class="fas fa-toilet"></i> ${nearbyStats.toilets} Toilets</span>
        </div>
      </div>

      <div class="info-cell-coverage">
        <h4 style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:8px">
          <i class="fas fa-signal" style="color:var(--accent)"></i> Cell Coverage (estimated)
        </h4>
        ${this.buildCellCoverageHTML(cellInfo)}
      </div>

      <div class="info-weather">
        <h4><i class="fas fa-cloud-sun"></i> 7-Day Forecast</h4>
        <div id="info-weather-loading"><p style="color:var(--text-muted);font-size:0.8rem"><i class="fas fa-spinner fa-spin"></i> Loading weather...</p></div>
      </div>

      <div class="info-actions">
        <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}" target="_blank" class="btn btn-sm">
          <i class="fas fa-directions"></i> Navigate
        </a>
        <button class="btn btn-sm" onclick="RoutePlanner.addAsWaypoint(${lat}, ${lon}, '${name.replace(/'/g, "\\'")}')">
          <i class="fas fa-plus"></i> Add to Route
        </button>
        <a href="${props.website || props.url || props['contact:website'] || props.URL || (operator === 'Department of Conservation (DOC)' ? 'https://www.doc.govt.nz/search?q=' + encodeURIComponent(name) : 'https://www.google.com/search?q=' + encodeURIComponent(name + ' NZ campsite'))}" target="_blank" class="btn btn-sm">
          <i class="fas fa-globe"></i> Website
        </a>
        <a href="https://www.google.com/maps/search/${encodeURIComponent(name)}/@${lat},${lon},15z" target="_blank" class="btn btn-sm">
          <i class="fab fa-google"></i> Google Maps
        </a>
        <a href="https://www.google.com/search?q=${encodeURIComponent(name + ' campsite NZ reviews')}" target="_blank" class="btn btn-sm">
          <i class="fas fa-star"></i> Reviews
        </a>
      </div>
    `;

    panel.classList.remove('hidden');

    // On mobile, close sidebar
    if (window.innerWidth <= 768) {
      document.getElementById('sidebar').classList.remove('open');
    }

    // Load weather async so panel shows immediately
    const weatherData = await Weather.fetchPointWeather(lat, lon);
    const weatherHTML = Weather.buildWeatherHTML(weatherData);
    const wxEl = document.getElementById('info-weather-loading');
    if (wxEl) wxEl.innerHTML = weatherHTML;
  },

  getNearbyStats(lat, lon) {
    const radius = 20;
    const result = { campsites: 0, fuel: 0, water: 0, shops: 0, toilets: 0 };
    const data = DataLoader.cache;

    const check = (features, type) => {
      if (!features) return;
      for (const f of features) {
        const [fLon, fLat] = f.geometry.coordinates;
        if (Utils.distance(lat, lon, fLat, fLon) <= radius) result[type]++;
      }
    };

    check(data.docCampsites?.features, 'campsites');
    check(data.osmCampsites?.features, 'campsites');

    if (data.osmAmenities?.features) {
      for (const f of data.osmAmenities.features) {
        const [fLon, fLat] = f.geometry.coordinates;
        if (Utils.distance(lat, lon, fLat, fLon) > radius) continue;
        const sub = f.properties.subtype;
        if (sub === 'fuel') result.fuel++;
        else if (sub === 'water') result.water++;
        else if (sub === 'shop') result.shops++;
        else if (sub === 'toilet') result.toilets++;
      }
    }
    return result;
  },

  findCellCoverage(lat, lon) {
    const data = DataLoader.cache.cellTowers;
    if (!data?.features) return { spark: 0, vodafone: 0, twodeg: 0 };

    const result = { spark: { dist: Infinity, tech: '' }, vodafone: { dist: Infinity, tech: '' }, twodeg: { dist: Infinity, tech: '' } };

    for (const f of data.features) {
      const [tLon, tLat] = f.geometry.coordinates;
      const dist = Utils.distance(lat, lon, tLat, tLon);

      const carrier = f.properties.carrier;
      const key = carrier === 'Spark' ? 'spark' : carrier === 'One NZ' ? 'vodafone' : 'twodeg';

      if (dist < result[key].dist) {
        result[key].dist = dist;
        result[key].tech = f.properties.technology;
      }
    }

    // Convert distance to signal strength (0-100)
    const distToSignal = (dist, tech) => {
      const maxRange = tech === '5G' ? 2 : tech === '4G' ? 10 : 20;
      if (dist > maxRange * 2) return 0;
      return Math.max(0, Math.round(100 * (1 - dist / (maxRange * 2))));
    };

    return {
      spark: { signal: distToSignal(result.spark.dist, result.spark.tech), tech: result.spark.tech, dist: result.spark.dist },
      vodafone: { signal: distToSignal(result.vodafone.dist, result.vodafone.tech), tech: result.vodafone.tech, dist: result.vodafone.dist },
      twodeg: { signal: distToSignal(result.twodeg.dist, result.twodeg.tech), tech: result.twodeg.tech, dist: result.twodeg.dist },
    };
  },

  buildCellCoverageHTML(info) {
    const row = (name, data, cls) => `
      <div class="cell-bar-container">
        <span class="cell-carrier">${name}</span>
        <div class="cell-bar"><div class="cell-bar-fill ${cls}" style="width:${data.signal}%"></div></div>
        <span class="cell-tech">${data.signal > 0 ? data.tech : 'None'}</span>
      </div>`;

    return row('Spark', info.spark, 'spark') +
           row('One NZ', info.vodafone, 'vodafone') +
           row('2degrees', info.twodeg, 'twodeg');
  }
};
