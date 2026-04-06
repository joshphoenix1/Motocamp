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
    this.setupOverpassLayers();
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
          fee: props.fee === 'no' ? 'Free' : (props._enriched_fee || props.charge || null),
          feeLevel: props.fee === 'no' || props._enriched_fee === 'Free' ? 'free' : 'paid',
        };

        if (props.description) facilities.description = props.description;
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
    this.map.addLayer(freedomGroup);
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
    // Discover carriers dynamically from data
    this._cellCarriers = [];
    if (!data.cellTowers?.features?.length) return;

    const carrierSet = new Set();
    for (const f of data.cellTowers.features) {
      if (f.properties.carrier) carrierSet.add(f.properties.carrier);
    }
    this._cellCarriers = [...carrierSet];

    // Build heatmap data per carrier
    const heatData = {};
    for (const carrier of this._cellCarriers) {
      heatData['cell-' + carrier] = [];
    }

    for (const f of data.cellTowers.features) {
      const [lon, lat] = f.geometry.coordinates;
      const props = f.properties;

      const techBase = props.technology === '4G' ? 0.9 :
                       props.technology === '3G' ? 0.6 :
                       props.technology === '5G' ? 1.0 : 0.4;
      const rangeBoost = Math.min((props.range || 5000) / 15000, 1.0);
      const intensity = techBase * (0.5 + 0.5 * rangeBoost);

      const key = 'cell-' + props.carrier;
      if (heatData[key]) {
        heatData[key].push([lat, lon, intensity]);
      }
    }

    // Color palette for up to 6 carriers
    const gradientPalette = [
      { 0.1: 'rgba(255,220,100,0)', 0.3: 'rgba(255,200,60,0.15)', 0.5: 'rgba(245,180,40,0.3)', 0.7: 'rgba(230,160,30,0.45)', 1.0: 'rgba(210,145,20,0.6)' },
      { 0.1: 'rgba(255,120,140,0)', 0.3: 'rgba(240,90,110,0.15)', 0.5: 'rgba(220,70,90,0.3)', 0.7: 'rgba(200,55,75,0.45)', 1.0: 'rgba(180,40,60,0.6)' },
      { 0.1: 'rgba(100,200,255,0)', 0.3: 'rgba(70,175,235,0.15)', 0.5: 'rgba(50,150,210,0.3)', 0.7: 'rgba(35,125,190,0.45)', 1.0: 'rgba(25,100,170,0.6)' },
      { 0.1: 'rgba(160,255,160,0)', 0.3: 'rgba(100,220,100,0.15)', 0.5: 'rgba(60,190,60,0.3)', 0.7: 'rgba(40,160,40,0.45)', 1.0: 'rgba(30,130,30,0.6)' },
      { 0.1: 'rgba(200,160,255,0)', 0.3: 'rgba(170,120,240,0.15)', 0.5: 'rgba(140,90,220,0.3)', 0.7: 'rgba(120,70,200,0.45)', 1.0: 'rgba(100,50,180,0.6)' },
      { 0.1: 'rgba(255,200,160,0)', 0.3: 'rgba(240,170,120,0.15)', 0.5: 'rgba(220,140,90,0.3)', 0.7: 'rgba(200,120,70,0.45)', 1.0: 'rgba(180,100,50,0.6)' },
    ];

    this._cellCarriers.forEach((carrier, i) => {
      const key = 'cell-' + carrier;
      const heat = L.heatLayer(heatData[key], {
        radius: 50,
        blur: 40,
        maxZoom: 13,
        max: 1.0,
        minOpacity: 0.02,
        gradient: gradientPalette[i % gradientPalette.length]
      });
      heat.on('add', function() {
        const el = this._canvas || this._container;
        if (el) el.style.opacity = '0.55';
      });
      this.groups[key] = heat;
    });
  },

  // ===== Overpass-driven global layers =====
  setupOverpassLayers() {
    if (typeof OverpassLoader === 'undefined') return;
    OverpassLoader.init(this.map);

    // Track features we've already added (by OSM id) to avoid duplicates
    this._overpassSeen = {};

    // Create cluster groups for each Overpass category
    const overpassCategories = [
      'campsites', 'fuel', 'water', 'toilets', 'shops', 'shelters',
      'dumpStations', 'repairs', 'picnicSites', 'viewpoints', 'passes', 'accommodation',
    ];

    for (const cat of overpassCategories) {
      const meta = OverpassLoader.categories[cat];
      if (!meta) continue;
      const key = 'overpass-' + cat;
      this._overpassSeen[cat] = new Set();
      this.groups[key] = L.markerClusterGroup({
        maxClusterRadius: 35,
        disableClusteringAtZoom: 14,
        showCoverageOnHover: false,
      });
    }

    // Listen for new data from Overpass
    OverpassLoader.onData((category, features) => {
      const key = 'overpass-' + category;
      const group = this.groups[key];
      const seen = this._overpassSeen[category];
      if (!group || !seen) return;

      const meta = OverpassLoader.categories[category];
      for (const f of features) {
        const id = f.properties._osm_id;
        if (seen.has(id)) continue;
        seen.add(id);

        const [lon, lat] = f.geometry.coordinates;
        const props = f.properties;
        const name = props.name || meta.label;

        const marker = L.marker([lat, lon], {
          icon: Utils.createMarker(meta.markerType, meta.icon),
        });

        // Build popup based on available tags
        let popup = `<div style="min-width:150px"><strong>${name}</strong>`;
        if (props.operator) popup += `<br><span style="font-size:0.8em">Operator: ${props.operator}</span>`;
        if (props.opening_hours) popup += `<br><span style="font-size:0.8em">Hours: ${props.opening_hours}</span>`;
        if (props.fee === 'no') popup += `<br><span style="font-size:0.8em;color:var(--accent)">Free</span>`;
        else if (props.fee === 'yes' || props.charge) popup += `<br><span style="font-size:0.8em">Fee: ${props.charge || 'yes'}</span>`;
        if (props.website) popup += `<br><a href="${props.website}" target="_blank" style="font-size:0.8em">Website</a>`;
        if (props.phone) popup += `<br><span style="font-size:0.8em">Phone: ${props.phone}</span>`;
        if (props.description) popup += `<br><span style="font-size:0.8em">${props.description}</span>`;

        // Campsite-specific tags
        if (category === 'campsites') {
          const amenities = [];
          if (props.drinking_water === 'yes') amenities.push('Water');
          if (props.toilets === 'yes') amenities.push('Toilets');
          if (props.shower === 'yes') amenities.push('Showers');
          if (props.power_supply === 'yes') amenities.push('Power');
          if (props.internet_access === 'yes' || props.internet_access === 'wlan') amenities.push('WiFi');
          if (props.sanitary_dump_station === 'yes') amenities.push('Dump');
          if (props.tents === 'yes') amenities.push('Tents');
          if (props.caravans === 'yes') amenities.push('Caravans');
          if (amenities.length) popup += `<br><span style="font-size:0.75em;color:var(--text-secondary)">${amenities.join(' · ')}</span>`;
          if (props.capacity) popup += `<br><span style="font-size:0.75em">${props.capacity} sites</span>`;
        }

        // Fuel-specific
        if (category === 'fuel') {
          const fuels = [];
          if (props['fuel:diesel'] === 'yes') fuels.push('Diesel');
          if (props['fuel:octane_95'] === 'yes' || props['fuel:octane_91'] === 'yes') fuels.push('Petrol');
          if (props['fuel:lpg'] === 'yes') fuels.push('LPG');
          if (fuels.length) popup += `<br><span style="font-size:0.75em">${fuels.join(' · ')}</span>`;
        }

        // Pass/viewpoint elevation
        if ((category === 'passes' || category === 'viewpoints') && props.ele) {
          popup += `<br><span style="font-size:0.8em">Elevation: ${props.ele}m</span>`;
        }

        popup += '</div>';
        marker.bindPopup(popup);
        group.addLayer(marker);
      }
    });
  },

  setupToggles() {
    document.querySelectorAll('[data-layer]').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const layerKey = e.target.dataset.layer;

        // Handle Overpass-backed layers
        if (layerKey.startsWith('overpass-')) {
          const category = layerKey.replace('overpass-', '');
          const group = this.groups[layerKey];
          if (e.target.checked) {
            if (group) this.map.addLayer(group);
            OverpassLoader.enableCategory(category);
          } else {
            if (group) this.map.removeLayer(group);
            OverpassLoader.disableCategory(category);
          }
          return;
        }

        const group = this.groups[layerKey];
        if (!group) return;

        if (e.target.checked) {
          this.map.addLayer(group);
        } else {
          this.map.removeLayer(group);
        }
      });
    });

    // Cell coverage toggle (controls all carriers)
    const cellAllToggle = document.getElementById('cell-all-toggle');
    if (cellAllToggle) {
      cellAllToggle.addEventListener('change', (e) => {
        const cellKeys = (this._cellCarriers || []).map(c => 'cell-' + c);
        cellKeys.forEach(key => {
          const group = this.groups[key];
          if (!group) return;
          if (e.target.checked) {
            this.map.addLayer(group);
          } else {
            this.map.removeLayer(group);
          }
        });
      });
    }
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
            Weather.map = this.map;
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
    const hours = props.opening_hours || props._enriched_hours || null;
    const isDOC = typeDesc.includes('Basic') || typeDesc.includes('Backcountry') || typeDesc.includes('Standard') || typeDesc.includes('Serviced') || typeDesc.includes('Great Walk') || typeDesc.includes('Scenic');
    const isFreedom = typeDesc === 'Freedom Camping';
    const hoursDisplay = hours === '24/7' || isDOC || isFreedom
      ? '<span style="color:var(--accent)">Open 24/7</span>'
      : hours
        ? hours
        : '';
    const hoursHTML = hoursDisplay
      ? `<div class="info-detail"><div class="info-detail-label">Opening Hours</div><div class="info-detail-value">${hoursDisplay}</div></div>`
      : '';

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
          <div class="info-detail-value">${
            facilities.fee === 'Free' || props.fee === 'no'
              ? '<span style="color:var(--accent)">Free</span>'
              : facilities.fee || props._enriched_fee || props.charge || ''
          }${
            !facilities.fee && !props._enriched_fee && !props.charge && props.fee !== 'no'
              ? '<span style="color:var(--text-muted);font-size:0.75rem">Unknown — <a href="https://www.google.com/search?q=' + encodeURIComponent((props.name || 'campsite') + ' campsite price') + '" target="_blank" style="color:var(--accent)">search</a></span>'
              : ''
          }${
            facilities.fee && facilities.fee.includes('est.') ? ' <span style="color:var(--text-muted);font-size:0.7rem">(estimated)</span>' : ''
          }</div>
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
        <a href="${props.website || props.url || props['contact:website'] || props.URL || (operator === 'Department of Conservation (DOC)' ? 'https://www.doc.govt.nz/search?q=' + encodeURIComponent(name) : 'https://www.google.com/search?q=' + encodeURIComponent(name + ' campsite'))}" target="_blank" class="btn btn-sm">
          <i class="fas fa-globe"></i> Website
        </a>
        <a href="https://www.google.com/maps/search/${encodeURIComponent(name)}/@${lat},${lon},15z" target="_blank" class="btn btn-sm">
          <i class="fab fa-google"></i> Google Maps
        </a>
        <a href="https://www.google.com/search?q=${encodeURIComponent(name + ' campsite reviews')}" target="_blank" class="btn btn-sm">
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

    // Also count Overpass-loaded markers if available
    const overpassMap = { campsites: 'overpass-campsites', fuel: 'overpass-fuel', water: 'overpass-water', shops: 'overpass-shops', toilets: 'overpass-toilets' };
    for (const [type, key] of Object.entries(overpassMap)) {
      const group = this.groups[key];
      if (!group) continue;
      group.eachLayer(marker => {
        const ll = marker.getLatLng();
        if (Utils.distance(lat, lon, ll.lat, ll.lng) <= radius) result[type]++;
      });
    }

    return result;
  },

  findCellCoverage(lat, lon) {
    const data = DataLoader.cache.cellTowers;
    const carriers = this._cellCarriers || [];
    if (!data?.features || carriers.length === 0) return [];

    // Track nearest tower per carrier
    const nearest = {};
    for (const c of carriers) nearest[c] = { dist: Infinity, tech: '' };

    for (const f of data.features) {
      const [tLon, tLat] = f.geometry.coordinates;
      const dist = Utils.distance(lat, lon, tLat, tLon);
      const carrier = f.properties.carrier;
      if (nearest[carrier] && dist < nearest[carrier].dist) {
        nearest[carrier].dist = dist;
        nearest[carrier].tech = f.properties.technology === '5G' ? '5G' : '4G';
      }
    }

    const distToSignal = (dist, tech) => {
      const maxRange = tech === '5G' ? 3 : 15;
      if (dist > maxRange * 2) return 0;
      return Math.max(0, Math.round(100 * (1 - dist / (maxRange * 2))));
    };

    return carriers.map((name, i) => ({
      name,
      index: i,
      signal: distToSignal(nearest[name].dist, nearest[name].tech),
      tech: nearest[name].tech,
      dist: nearest[name].dist,
    }));
  },

  buildCellCoverageHTML(info) {
    if (!info || info.length === 0) return '<span style="color:var(--text-muted);font-size:0.8rem">No cell data available</span>';

    const cssClasses = ['spark', 'vodafone', 'twodeg', 'carrier-3', 'carrier-4', 'carrier-5'];
    return info.map(c => `
      <div class="cell-bar-container">
        <span class="cell-carrier">${c.name}</span>
        <div class="cell-bar"><div class="cell-bar-fill ${cssClasses[c.index] || 'carrier-' + c.index}" style="width:${c.signal}%"></div></div>
        <span class="cell-tech">${c.signal > 0 ? c.tech : 'None'}</span>
      </div>`).join('');
  }
};
