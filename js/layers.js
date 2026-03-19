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

    // DOC Huts
    const docHutGroup = L.markerClusterGroup({
      maxClusterRadius: 35,
      iconCreateFunction: (cluster) => L.divIcon({
        html: `<div>${cluster.getChildCount()}</div>`,
        className: 'marker-cluster marker-cluster-hut',
        iconSize: [32, 32]
      })
    });

    if (data.docHuts?.features) {
      for (const f of data.docHuts.features) {
        const [lon, lat] = f.geometry.coordinates;
        const props = f.properties;
        const name = props.DESCRIPTION || props.name || 'DOC Hut';

        const marker = L.marker([lat, lon], {
          icon: Utils.createMarker('hut', 'house-chimney')
        });

        marker.on('click', () => this.showHutInfo(name, props, lat, lon));
        docHutGroup.addLayer(marker);
      }
    }
    this.groups['doc-huts'] = docHutGroup;
    this.map.addLayer(docHutGroup);

    // OSM Campsites (commercial and freedom)
    const commercialGroup = L.markerClusterGroup({ maxClusterRadius: 35 });
    const freedomGroup = L.markerClusterGroup({ maxClusterRadius: 30 });

    if (data.osmCampsites?.features) {
      for (const f of data.osmCampsites.features) {
        const [lon, lat] = f.geometry.coordinates;
        const props = f.properties;
        const name = props.name || 'Campsite';

        // Determine if commercial or freedom camping
        const isFreedom = props.fee === 'no' || props.backcountry === 'yes' ||
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
    const carrierGroups = {
      'cell-spark': L.layerGroup(),
      'cell-vodafone': L.layerGroup(),
      'cell-2degrees': L.layerGroup(),
    };

    if (data.cellTowers?.features) {
      for (const f of data.cellTowers.features) {
        const [lon, lat] = f.geometry.coordinates;
        const props = f.properties;

        const marker = L.marker([lat, lon], {
          icon: Utils.createTowerMarker(props.carrier)
        });

        marker.bindPopup(`
          <div style="min-width:120px">
            <strong>${props.carrier}</strong><br>
            <span style="font-size:0.85em">${props.technology}</span><br>
            <span style="color:var(--text-muted);font-size:0.8em">${props.location}</span>
          </div>
        `);

        // Also draw approximate coverage circle
        const radius = props.technology === '5G' ? 1500 :
                       props.technology === '4G' ? 5000 : 8000;

        const circleColor = props.carrier === 'Spark' ? '#ffe600' :
                           props.carrier === 'Vodafone' ? '#e60000' : '#00aaff';

        const circle = L.circle([lat, lon], {
          radius: radius,
          color: circleColor,
          fillColor: circleColor,
          fillOpacity: 0.05,
          weight: 0.5,
          opacity: 0.3
        });

        const key = props.carrier === 'Spark' ? 'cell-spark' :
                    props.carrier === 'Vodafone' ? 'cell-vodafone' : 'cell-2degrees';

        carrierGroups[key].addLayer(marker);
        carrierGroups[key].addLayer(circle);
      }
    }

    for (const [key, group] of Object.entries(carrierGroups)) {
      this.groups[key] = group;
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
          Weather.removeOverlay(this.map);
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
      if (this.activeWeatherType) {
        Weather.createOverlay(this.map, this.activeWeatherType, hour);
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
        Weather.startAnimation(this.map, this.activeWeatherType);
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

    // Remove the initial base layer added in app.js, replace with managed one
    this.map.eachLayer(layer => {
      if (layer instanceof L.TileLayer) this.map.removeLayer(layer);
    });
    let activeBasemap = basemaps.streets;
    this.map.addLayer(activeBasemap);

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

    const status = props.STATUS || 'OPEN';
    const isOpen = status === 'OPEN';

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

    // Fetch weather
    const weatherData = await Weather.fetchPointWeather(lat, lon);
    const weatherHTML = Weather.buildWeatherHTML(weatherData);

    content.innerHTML = `
      <div class="info-header">
        <h2>${name}</h2>
        <span class="info-type">${typeDesc}</span>
        <span class="info-status ${isOpen ? 'open' : 'closed'}">${isOpen ? 'Open' : 'Closed'}</span>
      </div>

      <div class="info-facilities">${facilityHTML}</div>

      <div class="info-details">
        <div class="info-detail">
          <div class="info-detail-label">Fee</div>
          <div class="info-detail-value">${facilities.fee || 'Check DOC website'}</div>
        </div>
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

      <div class="info-cell-coverage">
        <h4 style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:8px">
          <i class="fas fa-signal" style="color:var(--accent)"></i> Cell Coverage (estimated)
        </h4>
        ${this.buildCellCoverageHTML(cellInfo)}
      </div>

      <div class="info-weather">
        <h4><i class="fas fa-cloud-sun"></i> 7-Day Forecast</h4>
        ${weatherHTML}
      </div>

      <div class="info-actions">
        <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}" target="_blank" class="btn btn-sm">
          <i class="fas fa-directions"></i> Navigate
        </a>
        <button class="btn btn-sm" onclick="RoutePlanner.addAsWaypoint(${lat}, ${lon}, '${name.replace(/'/g, "\\'")}')">
          <i class="fas fa-plus"></i> Add to Route
        </button>
        ${props.URL || props.website ? `
        <a href="${props.URL || props.website}" target="_blank" class="btn btn-sm">
          <i class="fas fa-external-link-alt"></i> Website
        </a>` : ''}
      </div>
    `;

    panel.classList.remove('hidden');

    // On mobile, close sidebar
    if (window.innerWidth <= 768) {
      document.getElementById('sidebar').classList.remove('open');
    }
  },

  async showHutInfo(name, props, lat, lon) {
    const weatherData = await Weather.fetchPointWeather(lat, lon);
    const weatherHTML = Weather.buildWeatherHTML(weatherData);
    const cellInfo = this.findCellCoverage(lat, lon);

    const panel = document.getElementById('info-panel');
    const content = document.getElementById('info-content');

    content.innerHTML = `
      <div class="info-header">
        <h2>${name}</h2>
        <span class="info-type">DOC Hut</span>
        <span class="info-status open">${props.STATUS || 'Open'}</span>
      </div>

      <div class="info-facilities">
        <span class="facility-badge available"><i class="fas fa-bed"></i> Bunks</span>
        <span class="facility-badge available"><i class="fas fa-toilet"></i> Toilet</span>
        <span class="facility-badge available"><i class="fas fa-droplet"></i> Water</span>
        <span class="facility-badge available"><i class="fas fa-fire"></i> Fireplace</span>
      </div>

      <div class="info-details">
        <div class="info-detail">
          <div class="info-detail-label">Fee</div>
          <div class="info-detail-value">$5-$15/night (backcountry pass)</div>
        </div>
        <div class="info-detail">
          <div class="info-detail-label">Coordinates</div>
          <div class="info-detail-value">${lat.toFixed(4)}, ${lon.toFixed(4)}</div>
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
        ${weatherHTML}
      </div>

      <div class="info-actions">
        <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}" target="_blank" class="btn btn-sm">
          <i class="fas fa-directions"></i> Navigate
        </a>
        <button class="btn btn-sm" onclick="RoutePlanner.addAsWaypoint(${lat}, ${lon}, '${name.replace(/'/g, "\\'")}')">
          <i class="fas fa-plus"></i> Add to Route
        </button>
      </div>
    `;

    panel.classList.remove('hidden');
  },

  findCellCoverage(lat, lon) {
    const data = DataLoader.cache.cellTowers;
    if (!data?.features) return { spark: 0, vodafone: 0, twodeg: 0 };

    const result = { spark: { dist: Infinity, tech: '' }, vodafone: { dist: Infinity, tech: '' }, twodeg: { dist: Infinity, tech: '' } };

    for (const f of data.features) {
      const [tLon, tLat] = f.geometry.coordinates;
      const dist = Utils.distance(lat, lon, tLat, tLon);

      const carrier = f.properties.carrier;
      const key = carrier === 'Spark' ? 'spark' : carrier === 'Vodafone' ? 'vodafone' : 'twodeg';

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
