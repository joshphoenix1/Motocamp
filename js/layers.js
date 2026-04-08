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
      'dumpStations', 'repairs', 'picnicSites', 'viewpoints', 'passes',
      'hostels', 'alpineHuts', 'hotels', 'guesthouses', 'cabins',
      'hospitals', 'atms', 'borderCrossings', 'restAreas', 'fords', 'ferries',
      'waterSources', 'embassies', 'cellTowers',
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

        // Build rich popup
        const popup = this._buildOverpassPopup(category, name, props, lat, lon);
        marker.bindPopup(popup);
        group.addLayer(marker);
      }
    });
  },

  // ===== Rich popup builder for all Overpass POIs =====
  _buildOverpassPopup(category, name, props, lat, lon) {
    const s = (sz, clr, txt) => `<span style="font-size:${sz};${clr ? 'color:' + clr + ';' : ''}">${txt}</span>`;
    const row = (label, val) => val ? `<div style="display:flex;justify-content:space-between;gap:8px;padding:2px 0;font-size:0.78em"><span style="color:#78909c">${label}</span><span>${val}</span></div>` : '';
    const badge = (icon, text, color) => `<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:4px;font-size:0.7em;background:${color || 'rgba(255,255,255,0.06)'};margin:2px">${icon ? '<i class="fas fa-' + icon + '" style="font-size:0.8em"></i>' : ''}${text}</span>`;
    const esc = (t) => t ? t.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

    let html = `<div style="min-width:200px;max-width:300px">`;

    // === Header ===
    html += `<div style="font-weight:700;font-size:1em;margin-bottom:4px">${esc(name)}</div>`;

    // Category type label
    const typeLabels = {
      campsites: this._classifyCampsite(props),
      fuel: 'Fuel Station', water: 'Drinking Water', toilets: 'Public Toilet',
      shops: props.shop === 'supermarket' ? 'Supermarket' : 'Convenience Store',
      shelters: props.tourism === 'wilderness_hut' ? 'Wilderness Hut' : 'Shelter',
      dumpStations: 'Dump Station', repairs: props.shop === 'motorcycle' ? 'Motorcycle Shop' : 'Repair / Mechanic',
      picnicSites: 'Picnic Site', viewpoints: 'Viewpoint', passes: 'Mountain Pass',
      hostels: 'Hostel / Backpackers',
      alpineHuts: 'Alpine Hut / Refuge',
      hotels: props.tourism === 'motel' ? 'Motel' : 'Hotel',
      guesthouses: props.tourism === 'bed_and_breakfast' ? 'Bed & Breakfast' : 'Guesthouse',
      cabins: props.tourism === 'chalet' ? 'Chalet' : 'Cabin',
      hospitals: props.emergency === 'yes' ? 'Hospital (Emergency)' : (props.amenity === 'clinic' ? 'Clinic' : 'Hospital'),
      atms: props.amenity === 'bank' ? 'Bank' : 'ATM',
      borderCrossings: 'Border Crossing', restAreas: 'Rest Area',
      fords: 'Ford / River Crossing', ferries: 'Ferry Terminal',
      waterSources: props.natural === 'spring' ? 'Natural Spring' : 'Water Well',
      embassies: 'Embassy / Consulate',
      cellTowers: 'Cell Tower',
    };
    const typeLabel = typeLabels[category] || category;
    html += `<div style="font-size:0.75em;color:#78909c;margin-bottom:8px">${typeLabel}</div>`;

    // === Operator / Brand ===
    if (props.operator || props.brand) {
      html += `<div style="font-size:0.8em;margin-bottom:6px"><i class="fas fa-building" style="color:var(--accent);width:14px"></i> ${esc(props.operator || props.brand)}</div>`;
    }

    // === Campsite-specific rich data ===
    if (category === 'campsites') {
      // Fee
      const fee = props.fee === 'no' ? '<span style="color:#00c853;font-weight:600">Free</span>' :
                  props.charge ? esc(props.charge) :
                  props.fee === 'yes' ? 'Paid' : '<span style="color:#78909c">Unknown</span>';
      html += row('Fee', fee);

      // Access type
      if (props.access) html += row('Access', esc(props.access));

      // Reservation
      if (props.reservation) html += row('Booking', esc(props.reservation));

      // Capacity
      if (props.capacity) html += row('Capacity', props.capacity + ' sites');

      // Amenity badges
      const amenities = [];
      if (props.drinking_water === 'yes') amenities.push(badge('droplet', 'Water', 'rgba(0,188,212,0.15)'));
      if (props.toilets === 'yes') amenities.push(badge('toilet', 'Toilets', 'rgba(96,125,139,0.15)'));
      if (props.shower === 'yes') amenities.push(badge('shower', 'Showers', 'rgba(0,150,255,0.15)'));
      if (props.power_supply === 'yes') amenities.push(badge('plug', 'Power', 'rgba(255,193,7,0.15)'));
      if (props.internet_access === 'yes' || props.internet_access === 'wlan') amenities.push(badge('wifi', 'WiFi', 'rgba(33,150,243,0.15)'));
      if (props.sanitary_dump_station === 'yes') amenities.push(badge('trailer', 'Dump', 'rgba(84,110,122,0.15)'));
      if (props.kitchen === 'yes') amenities.push(badge('utensils', 'Kitchen', 'rgba(255,152,0,0.15)'));
      if (props.bbq === 'yes') amenities.push(badge('fire', 'BBQ', 'rgba(255,87,34,0.15)'));
      if (props.washing_machine === 'yes') amenities.push(badge('shirt', 'Laundry', 'rgba(156,39,176,0.15)'));
      if (props.picnic_table === 'yes') amenities.push(badge('utensils', 'Tables', 'rgba(139,195,74,0.15)'));
      if (amenities.length) html += `<div style="display:flex;flex-wrap:wrap;gap:2px;margin:6px 0">${amenities.join('')}</div>`;

      // Vehicle/accommodation type badges
      const types = [];
      if (props.tents === 'yes') types.push(badge('campground', 'Tents'));
      if (props.caravans === 'yes') types.push(badge('caravan', 'Caravans'));
      if (props.motorhome === 'yes') types.push(badge('truck-monster', 'Motorhome'));
      if (props.backcountry === 'yes') types.push(badge('hiking', 'Backcountry'));
      if (props.group_only === 'yes') types.push(badge('users', 'Group only'));
      if (types.length) html += `<div style="display:flex;flex-wrap:wrap;gap:2px;margin:4px 0">${types.join('')}</div>`;

      // Fire / dogs / wheelchair
      const rules = [];
      if (props.openfire === 'yes') rules.push('Campfires OK');
      else if (props.openfire === 'no') rules.push('No campfires');
      if (props.dog === 'yes') rules.push('Dogs allowed');
      else if (props.dog === 'leashed') rules.push('Dogs on leash');
      else if (props.dog === 'no') rules.push('No dogs');
      if (props.wheelchair === 'yes') rules.push('Wheelchair accessible');
      if (rules.length) html += `<div style="font-size:0.72em;color:#b0bec5;margin:4px 0">${rules.join(' · ')}</div>`;

      // Surface
      if (props.surface) html += row('Surface', esc(props.surface));

      // Payment
      const payments = [];
      if (props['payment:cash'] === 'yes') payments.push('Cash');
      if (props['payment:cards'] === 'yes' || props['payment:credit_cards'] === 'yes') payments.push('Card');
      if (payments.length) html += row('Payment', payments.join(', '));

      // Cell coverage estimate from global tower data
      const cellEst = this._estimateCellCoverage(lat, lon);
      if (cellEst) html += cellEst;
    }

    // === Fuel-specific ===
    if (category === 'fuel') {
      const fuels = [];
      if (props['fuel:diesel'] === 'yes') fuels.push(badge('', 'Diesel', 'rgba(255,193,7,0.15)'));
      if (props['fuel:octane_91'] === 'yes') fuels.push(badge('', '91', 'rgba(0,200,83,0.15)'));
      if (props['fuel:octane_95'] === 'yes') fuels.push(badge('', '95', 'rgba(33,150,243,0.15)'));
      if (props['fuel:octane_98'] === 'yes') fuels.push(badge('', '98', 'rgba(156,39,176,0.15)'));
      if (props['fuel:lpg'] === 'yes') fuels.push(badge('', 'LPG', 'rgba(255,152,0,0.15)'));
      if (props['fuel:e85'] === 'yes') fuels.push(badge('', 'E85', 'rgba(139,195,74,0.15)'));
      if (props['fuel:HGV_diesel'] === 'yes') fuels.push(badge('', 'Truck Diesel', 'rgba(255,87,34,0.15)'));
      if (fuels.length) html += `<div style="display:flex;flex-wrap:wrap;gap:2px;margin:6px 0">${fuels.join('')}</div>`;
      else html += `<div style="font-size:0.75em;color:#78909c;margin:4px 0">Fuel types not specified</div>`;
      if (props.brand) html += row('Brand', esc(props.brand));
    }

    // === Hospital ===
    if (category === 'hospitals') {
      if (props.emergency === 'yes') html += `<div style="font-size:0.82em;color:#ff5252;font-weight:600;margin:4px 0"><i class="fas fa-star-of-life"></i> Emergency Department</div>`;
      if (props.healthcare) html += row('Type', esc(props.healthcare));
      if (props.beds) html += row('Beds', props.beds);
      if (props['healthcare:speciality']) html += row('Speciality', esc(props['healthcare:speciality']));
    }

    // === Border crossing ===
    if (category === 'borderCrossings') {
      if (props.border_type) html += row('Type', esc(props.border_type));
      const modes = [];
      if (props.foot !== 'no') modes.push('Pedestrian');
      if (props.motorcar !== 'no') modes.push('Vehicle');
      if (modes.length) html += row('Access', modes.join(', '));
    }

    // === Ford ===
    if (category === 'fords') {
      if (props.depth) html += row('Depth', props.depth + 'm');
      if (props.surface) html += row('Surface', esc(props.surface));
      if (props.width) html += row('Width', props.width + 'm');
    }

    // === Water sources ===
    if (category === 'waterSources') {
      if (props.drinking_water === 'yes') html += `<div style="font-size:0.82em;color:#00c853;font-weight:600;margin:4px 0"><i class="fas fa-check-circle"></i> Safe to drink</div>`;
      else html += `<div style="font-size:0.82em;color:#ffab40;margin:4px 0"><i class="fas fa-exclamation-triangle"></i> Filter/treat required</div>`;
      if (props.flow_rate) html += row('Flow', esc(props.flow_rate));
      if (props.seasonal === 'yes') html += `<div style="font-size:0.75em;color:#ffab40;margin:2px 0"><i class="fas fa-calendar"></i> Seasonal — may be dry</div>`;
    }

    // === Pass/viewpoint elevation ===
    if ((category === 'passes' || category === 'viewpoints') && props.ele) {
      html += row('Elevation', Math.round(parseFloat(props.ele)) + 'm');
    }

    // === Embassy ===
    if (category === 'embassies') {
      if (props.country) html += row('Country', esc(props.country));
      if (props['diplomatic']) html += row('Type', esc(props['diplomatic']));
    }

    // === ATM ===
    if (category === 'atms') {
      if (props.network || props.operator) html += row('Network', esc(props.network || props.operator));
      const currencies = props.currency || props['currency:XCD'] || props['currency:USD'] || '';
      if (currencies) html += row('Currency', esc(currencies));
      if (props.cash_in === 'yes') html += `<div style="font-size:0.75em;color:#78909c">Accepts deposits</div>`;
    }

    // === Cell towers ===
    if (category === 'cellTowers') {
      if (props.operator) html += row('Operator', esc(props.operator));
      const techs = [];
      if (props['communication:gsm'] === 'yes') techs.push('2G');
      if (props['communication:umts'] === 'yes') techs.push('3G');
      if (props['communication:lte'] === 'yes') techs.push('4G');
      if (props['communication:5g'] === 'yes' || props['communication:nr'] === 'yes') techs.push('5G');
      if (techs.length) html += row('Technology', techs.join(' / '));
      if (props.height) html += row('Height', props.height + 'm');
      if (props.ref) html += row('Ref', esc(props.ref));
    }

    // === Rest area ===
    if (category === 'restAreas') {
      const rest = [];
      if (props.toilets === 'yes') rest.push(badge('toilet', 'Toilets'));
      if (props.drinking_water === 'yes') rest.push(badge('droplet', 'Water'));
      if (props.picnic_table === 'yes') rest.push(badge('utensils', 'Tables'));
      if (props.shelter === 'yes') rest.push(badge('house', 'Shelter'));
      if (rest.length) html += `<div style="display:flex;flex-wrap:wrap;gap:2px;margin:6px 0">${rest.join('')}</div>`;
    }

    // === Ferry ===
    if (category === 'ferries') {
      if (props.route) html += row('Route', esc(props.route));
      if (props.duration) html += row('Duration', esc(props.duration));
      if (props.motorcar === 'yes') html += `<div style="font-size:0.75em;color:#00c853"><i class="fas fa-car"></i> Vehicles accepted</div>`;
    }

    // === Shelters & Huts ===
    if (category === 'shelters') {
      const shelterFeats = [];
      if (props.fireplace === 'yes') shelterFeats.push(badge('fire', 'Fireplace'));
      if (props.drinking_water === 'yes') shelterFeats.push(badge('droplet', 'Water'));
      if (props.toilets === 'yes') shelterFeats.push(badge('toilet', 'Toilets'));
      if (props.bed === 'yes' || props.beds) shelterFeats.push(badge('bed', props.beds ? props.beds + ' beds' : 'Beds'));
      if (shelterFeats.length) html += `<div style="display:flex;flex-wrap:wrap;gap:2px;margin:6px 0">${shelterFeats.join('')}</div>`;
      if (props.ele) html += row('Elevation', Math.round(parseFloat(props.ele)) + 'm');
      if (props.fee === 'no') html += row('Fee', '<span style="color:#00c853">Free</span>');
      else if (props.charge) html += row('Fee', esc(props.charge));
    }

    // === Accommodation (all types) ===
    if (['hostels', 'alpineHuts', 'hotels', 'guesthouses', 'cabins'].includes(category)) {
      if (props.beds) html += row('Beds', props.beds);
      if (props.rooms) html += row('Rooms', props.rooms);
      if (props.stars) html += row('Rating', '★'.repeat(parseInt(props.stars)));
      if (props.fee === 'no') html += row('Fee', '<span style="color:#00c853">Free</span>');
      else if (props.charge) html += row('Fee', esc(props.charge));
      if (props.ele) html += row('Elevation', Math.round(parseFloat(props.ele)) + 'm');
      const accFeats = [];
      if (props.internet_access === 'yes' || props.internet_access === 'wlan') accFeats.push(badge('wifi', 'WiFi'));
      if (props.shower === 'yes') accFeats.push(badge('shower', 'Showers'));
      if (props.kitchen === 'yes') accFeats.push(badge('utensils', 'Kitchen'));
      if (accFeats.length) html += `<div style="display:flex;flex-wrap:wrap;gap:2px;margin:6px 0">${accFeats.join('')}</div>`;
    }

    // === Repair shops ===
    if (category === 'repairs') {
      const repairServices = [];
      if (props['service:vehicle:tyres'] === 'yes') repairServices.push('Tyres');
      if (props['service:vehicle:oil_change'] === 'yes') repairServices.push('Oil change');
      if (props['service:vehicle:welding'] === 'yes') repairServices.push('Welding');
      if (props['service:vehicle:electrical'] === 'yes') repairServices.push('Electrical');
      if (repairServices.length) html += `<div style="font-size:0.75em;color:#b0bec5;margin:4px 0">${repairServices.join(' · ')}</div>`;
    }

    // === Common fields for all categories ===
    if (props.opening_hours) html += row('Hours', esc(props.opening_hours));
    if (props.phone || props['contact:phone']) html += row('Phone', esc(props.phone || props['contact:phone']));
    if (props.description && category !== 'campsites') html += `<div style="font-size:0.75em;color:#b0bec5;margin:6px 0;line-height:1.4">${esc(props.description).substring(0, 200)}</div>`;
    if (category === 'campsites' && props.description) html += `<div style="font-size:0.75em;color:#b0bec5;margin:6px 0;line-height:1.4">${esc(props.description).substring(0, 300)}</div>`;

    // === Coordinates ===
    html += `<div style="font-size:0.68em;color:#546e7a;margin-top:6px">${lat.toFixed(5)}, ${lon.toFixed(5)}</div>`;

    // === Action links ===
    html += `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06)">`;
    // Directions (in-app route)
    html += `<a href="#" onclick="event.preventDefault();RoutePlanner.directionsTo(${lat},${lon},'${name.replace(/'/g, "\\'")}')" style="font-size:0.72em;color:var(--accent);text-decoration:none"><i class="fas fa-directions"></i> Directions</a>`;
    // Google Maps
    html += `<a href="https://www.google.com/maps/search/${encodeURIComponent(name)}/@${lat},${lon},15z" target="_blank" style="font-size:0.72em;color:var(--accent);text-decoration:none"><i class="fab fa-google"></i> Maps</a>`;
    // Website
    const website = props.website || props.url || props['contact:website'];
    if (website) html += `<a href="${website}" target="_blank" style="font-size:0.72em;color:var(--accent);text-decoration:none"><i class="fas fa-globe"></i> Website</a>`;
    // Reviews search (campsites only)
    if (category === 'campsites' && name !== 'Campsites') {
      html += `<a href="https://www.google.com/search?q=${encodeURIComponent(name + ' campsite reviews')}" target="_blank" style="font-size:0.72em;color:var(--accent);text-decoration:none"><i class="fas fa-star"></i> Reviews</a>`;
    }
    html += `</div>`;

    html += `</div>`;
    return html;
  },

  // Estimate cell coverage at a location from global Overpass tower data + static NZ data
  _estimateCellCoverage(lat, lon) {
    const maxDist = 20; // km — towers beyond this are too far
    const towers = [];

    // Check Overpass-loaded global cell towers
    const globalGroup = this.groups['overpass-cellTowers'];
    if (globalGroup) {
      globalGroup.eachLayer(marker => {
        const ll = marker.getLatLng();
        const dist = Utils.distance(lat, lon, ll.lat, ll.lng);
        if (dist <= maxDist) {
          // Get operator from the popup content or stored data
          const popup = marker.getPopup();
          const content = popup ? popup.getContent() : '';
          // Extract operator from data attribute if available
          towers.push({ dist, lat: ll.lat, lon: ll.lng, source: 'osm' });
        }
      });
    }

    // Check static NZ cell tower data
    const staticData = DataLoader.cache.cellTowers;
    if (staticData?.features) {
      for (const f of staticData.features) {
        const [tLon, tLat] = f.geometry.coordinates;
        const dist = Utils.distance(lat, lon, tLat, tLon);
        if (dist <= maxDist) {
          towers.push({
            dist,
            carrier: f.properties.carrier,
            tech: f.properties.technology,
            source: 'static',
          });
        }
      }
    }

    if (towers.length === 0) return '';

    // Estimate signal quality from nearest tower distance
    const nearest = Math.min(...towers.map(t => t.dist));
    let signal, signalLabel, signalColor;
    if (nearest < 2) { signal = 'Excellent'; signalLabel = '4-5 bars'; signalColor = '#00c853'; }
    else if (nearest < 5) { signal = 'Good'; signalLabel = '3-4 bars'; signalColor = '#00c853'; }
    else if (nearest < 10) { signal = 'Fair'; signalLabel = '2-3 bars'; signalColor = '#ffab40'; }
    else if (nearest < 15) { signal = 'Weak'; signalLabel = '1-2 bars'; signalColor = '#ff9800'; }
    else { signal = 'Marginal'; signalLabel = '0-1 bars'; signalColor = '#ff5252'; }

    let html = `<div style="background:rgba(255,255,255,0.03);border-radius:6px;padding:8px;margin:8px 0">`;
    html += `<div style="font-size:0.75em;color:#78909c;margin-bottom:4px"><i class="fas fa-signal"></i> Cell Coverage (est.)</div>`;
    html += `<div style="display:flex;align-items:center;gap:8px">`;
    html += `<span style="font-size:0.85em;font-weight:600;color:${signalColor}">${signal}</span>`;
    html += `<span style="font-size:0.72em;color:#78909c">${signalLabel} · ${towers.length} tower${towers.length > 1 ? 's' : ''} within ${maxDist}km · nearest ${nearest.toFixed(1)}km</span>`;
    html += `</div>`;

    // Show carriers if we have that data (from static NZ data)
    const carriers = {};
    for (const t of towers) {
      if (t.carrier) {
        if (!carriers[t.carrier] || t.dist < carriers[t.carrier].dist) {
          carriers[t.carrier] = { dist: t.dist, tech: t.tech };
        }
      }
    }
    const carrierNames = Object.keys(carriers);
    if (carrierNames.length > 0) {
      html += `<div style="font-size:0.7em;color:#b0bec5;margin-top:4px">${carrierNames.map(c => `${c} (${carriers[c].tech}, ${carriers[c].dist.toFixed(1)}km)`).join(' · ')}</div>`;
    }

    html += `</div>`;
    return html;
  },

  // Classify campsite type from OSM tags
  _classifyCampsite(props) {
    const name = (props.name || '').toLowerCase();
    const op = (props.operator || '').toLowerCase();
    if (props.backcountry === 'yes') return 'Backcountry Campsite';
    if (props.group_only === 'yes') return 'Group Campsite';
    if (name.includes('dispersed') || name.includes('primitive') || name.includes('wild camp')) return 'Dispersed Camping';
    if (name.includes('blm') || op.includes('bureau of land management') || op.includes('blm')) return 'BLM Dispersed Camping';
    if (op.includes('forest service') || op.includes('usfs') || op.includes('usda')) return 'USFS Campground';
    if (op.includes('national park') || op.includes('nps')) return 'National Park Campground';
    if (op.includes('state park')) return 'State Park Campground';
    if (op.includes('department of conservation') || op.includes('doc')) return 'DOC Campsite';
    if (props.tourism === 'caravan_site') return 'RV / Caravan Park';
    if (props.fee === 'no') return 'Free Campsite';
    if (name.includes('rv') || name.includes('caravan') || name.includes('holiday park')) return 'RV / Holiday Park';
    if (name.includes('koa') || name.includes('jellystone')) return 'Commercial Campground';
    return 'Campsite';
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
        <button class="btn btn-sm" onclick="RoutePlanner.directionsTo(${lat}, ${lon}, '${name.replace(/'/g, "\\'")}')">
          <i class="fas fa-directions"></i> Directions
        </button>
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
    const overpassMap = { campsites: 'overpass-campsites', fuel: 'overpass-fuel', water: 'overpass-water', shops: 'overpass-shops', toilets: 'overpass-toilets', hospitals: 'overpass-hospitals' };
    result.hospitals = 0;
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
