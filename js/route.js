/* ===== Route Planning Module ===== */
const RoutePlanner = {
  waypoints: [],
  routeControl: null,
  routeMarkers: [],
  routeLine: null,

  init(map) {
    this.map = map;
    this.setupEventListeners();
  },

  setupEventListeners() {
    document.getElementById('add-waypoint').addEventListener('click', () => this.addWaypointInput());
    document.getElementById('clear-route').addEventListener('click', () => this.clearRoute());
    document.getElementById('plan-route').addEventListener('click', () => this.planRoute());

    // Re-route when gravel toggle changes (if route exists)
    const gravelToggle = document.getElementById('gravel-bias');
    if (gravelToggle) {
      gravelToggle.addEventListener('change', () => {
        const startInput = document.getElementById('route-start');
        const endInput = document.getElementById('route-end');
        if (startInput.dataset.lat && endInput.dataset.lat) {
          this.planRoute();
        }
      });
    }

    // Route input geocoding
    this.setupInputGeocoding('route-start');
    this.setupInputGeocoding('route-end');
  },

  setupInputGeocoding(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    let resultsDiv;
    input.addEventListener('focus', () => {
      if (!resultsDiv) {
        resultsDiv = document.createElement('div');
        resultsDiv.className = 'search-results';
        resultsDiv.style.position = 'absolute';
        resultsDiv.style.zIndex = '9999';
        resultsDiv.style.width = input.parentElement.offsetWidth + 'px';
        input.parentElement.style.position = 'relative';
        input.parentElement.appendChild(resultsDiv);
      }
    });

    input.addEventListener('input', Utils.debounce(async () => {
      const q = input.value.trim();
      if (q.length < 3) {
        if (resultsDiv) resultsDiv.classList.add('hidden');
        return;
      }

      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=nz&limit=5`
        );
        const data = await resp.json();
        if (resultsDiv && data.length) {
          resultsDiv.innerHTML = data.map(r =>
            `<div class="search-result-item" data-lat="${r.lat}" data-lon="${r.lon}">
              <i class="fas fa-map-marker-alt"></i>${r.display_name.split(',').slice(0, 2).join(', ')}
            </div>`
          ).join('');
          resultsDiv.classList.remove('hidden');

          resultsDiv.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
              input.value = item.textContent.trim();
              input.dataset.lat = item.dataset.lat;
              input.dataset.lon = item.dataset.lon;
              resultsDiv.classList.add('hidden');
            });
          });
        }
      } catch (e) { console.warn('Geocoding failed', e); }
    }, 400));
  },

  addWaypointInput() {
    const container = document.getElementById('route-waypoints-container');
    const idx = container.children.length;
    const div = document.createElement('div');
    div.className = 'route-point';
    div.innerHTML = `
      <i class="fas fa-circle route-waypoint-icon"></i>
      <input type="text" class="route-waypoint-input" placeholder="Stop ${idx + 1}" autocomplete="off" />
      <button class="btn btn-sm" onclick="this.parentElement.remove()" style="padding:4px;border:none;">
        <i class="fas fa-times" style="color:var(--text-muted)"></i>
      </button>
    `;
    container.appendChild(div);

    const input = div.querySelector('input');
    this.setupInputGeocoding2(input);
  },

  setupInputGeocoding2(input) {
    let resultsDiv;
    input.addEventListener('input', Utils.debounce(async () => {
      const q = input.value.trim();
      if (q.length < 3) return;

      if (!resultsDiv) {
        resultsDiv = document.createElement('div');
        resultsDiv.className = 'search-results';
        resultsDiv.style.position = 'absolute';
        resultsDiv.style.zIndex = '9999';
        resultsDiv.style.width = '100%';
        input.parentElement.style.position = 'relative';
        input.parentElement.appendChild(resultsDiv);
      }

      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=nz&limit=5`
        );
        const data = await resp.json();
        if (data.length) {
          resultsDiv.innerHTML = data.map(r =>
            `<div class="search-result-item" data-lat="${r.lat}" data-lon="${r.lon}">
              <i class="fas fa-map-marker-alt"></i>${r.display_name.split(',').slice(0, 2).join(', ')}
            </div>`
          ).join('');
          resultsDiv.classList.remove('hidden');

          resultsDiv.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
              input.value = item.textContent.trim();
              input.dataset.lat = item.dataset.lat;
              input.dataset.lon = item.dataset.lon;
              resultsDiv.classList.add('hidden');
            });
          });
        }
      } catch (e) { console.warn('Geocoding failed', e); }
    }, 400));
  },

  async planRoute() {
    const startInput = document.getElementById('route-start');
    const endInput = document.getElementById('route-end');

    const start = startInput.dataset.lat ? L.latLng(parseFloat(startInput.dataset.lat), parseFloat(startInput.dataset.lon)) : null;
    const end = endInput.dataset.lat ? L.latLng(parseFloat(endInput.dataset.lat), parseFloat(endInput.dataset.lon)) : null;

    if (!start || !end) {
      alert('Please select start and end locations from the search suggestions.');
      return;
    }

    // Collect waypoints
    const waypointInputs = document.querySelectorAll('.route-waypoint-input');
    const waypoints = [];
    waypointInputs.forEach(inp => {
      if (inp.dataset.lat) {
        waypoints.push(L.latLng(parseFloat(inp.dataset.lat), parseFloat(inp.dataset.lon)));
      }
    });

    let allPoints = [start, ...waypoints, end];

    // Clear previous route
    this.clearRouteDisplay();

    const gravelBias = document.getElementById('gravel-bias')?.checked;

    // Inject gravel road waypoints if gravel mode is on
    if (gravelBias && typeof GravelRoads !== 'undefined') {
      const gravelWPs = GravelRoads.getGravelWaypoints(
        start.lat, start.lng, end.lat, end.lng
      );
      if (gravelWPs.length > 0) {
        console.log(`Gravel mode: injecting ${gravelWPs.length} waypoints:`,
          gravelWPs.map(w => w.name).join(', '));

        // Insert gravel waypoints between start and end, respecting user waypoints
        const gravelLatLngs = gravelWPs.map(w => L.latLng(w.lat, w.lon));
        allPoints = [start, ...waypoints, ...gravelLatLngs, end];

        // Re-sort all middle points by distance from start
        const middle = allPoints.slice(1, -1);
        middle.sort((a, b) => {
          const da = start.distanceTo(a);
          const db = start.distanceTo(b);
          return da - db;
        });
        allPoints = [start, ...middle, end];
      }
    }

    // Use OSRM for routing
    try {
      this.routeControl = L.Routing.control({
        waypoints: allPoints,
        router: L.Routing.osrmv1({
          serviceUrl: 'https://router.project-osrm.org/route/v1',
          profile: 'car',
          useHints: false
        }),
        routeWhileDragging: false,
        alternatives: true,
        lineOptions: {
          styles: [
            { color: '#ff1744', opacity: 0.85, weight: 5 },
            { color: '#ff5252', opacity: 0.4, weight: 9 }
          ],
          altLineOptions: {
            styles: [
              { color: '#ff9800', opacity: 0.6, weight: 4, dashArray: '8, 6' },
              { color: '#ffb74d', opacity: 0.3, weight: 8, dashArray: '8, 6' }
            ]
          }
        },
        show: false,
        addWaypoints: false,
        fitSelectedRoutes: true,
        createMarker: (i, wp) => {
          const isStart = i === 0;
          const isEnd = i === allPoints.length - 1;
          const marker = L.marker(wp.latLng, {
            icon: L.divIcon({
              className: 'custom-marker',
              html: `<i class="fas fa-${isStart ? 'play' : isEnd ? 'flag-checkered' : 'circle'}"
                     style="color:${isStart ? '#00c853' : isEnd ? '#ff5252' : '#40c4ff'}"></i>`,
              iconSize: [28, 28],
              iconAnchor: [14, 14]
            })
          });
          this.routeMarkers.push(marker);
          return marker;
        }
      }).addTo(this.map);

      this.routeControl.on('routesfound', async (e) => {
        const route = e.routes[0];
        const altRoutes = e.routes.slice(1);
        await this.generateRouteSummary(route, allPoints, altRoutes);
      });

    } catch (e) {
      console.error('Routing failed:', e);
      // Fallback: draw straight lines
      this.routeLine = L.polyline(allPoints, {
        color: '#ff1744', weight: 4, opacity: 0.7, dashArray: '10, 10'
      }).addTo(this.map);
      this.map.fitBounds(this.routeLine.getBounds(), { padding: [50, 50] });
    }
  },

  async generateRouteSummary(route, points, altRoutes) {
    const summary = document.getElementById('route-summary');
    const content = document.getElementById('route-summary-content');

    const totalKm = (route.summary.totalDistance / 1000).toFixed(0);
    const totalHours = (route.summary.totalTime / 3600);

    let html = `
      <div class="route-overview">
        <div class="route-stat">
          <div class="route-stat-value">${totalKm}km</div>
          <div class="route-stat-label">Total Distance</div>
        </div>
        <div class="route-stat">
          <div class="route-stat-value">${Utils.formatDuration(totalHours)}</div>
          <div class="route-stat-label">Drive Time</div>
        </div>
      </div>
    `;

    // Show alternate routes if available
    if (altRoutes && altRoutes.length > 0) {
      html += '<div style="margin-bottom:12px"><h4 style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:6px"><i class="fas fa-code-branch" style="color:#ff9800"></i> Alternate Routes</h4>';
      for (let a = 0; a < altRoutes.length; a++) {
        const alt = altRoutes[a];
        const altKm = (alt.summary.totalDistance / 1000).toFixed(0);
        const altHours = (alt.summary.totalTime / 3600);
        const diff = altKm - totalKm;
        html += `<div style="display:flex;gap:12px;align-items:center;padding:6px 8px;background:var(--bg-tertiary);border-radius:var(--radius);margin-bottom:4px;font-size:0.8rem;border-left:3px solid #ff9800">
          <span style="font-weight:600">${altKm}km</span>
          <span>${Utils.formatDuration(altHours)}</span>
          <span style="color:var(--text-muted)">${diff > 0 ? '+' : ''}${diff}km</span>
        </div>`;
      }
      html += '</div>';
    }

    // Fetch weather for each point
    html += '<div class="route-segments">';

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const isStart = i === 0;
      const isEnd = i === points.length - 1;
      const label = isStart ? 'Start' : isEnd ? 'Destination' : `Stop ${i}`;

      // Get weather
      const wxData = await Weather.fetchPointWeather(p.lat, p.lng);
      const dayIdx = Math.min(i, 6); // Spread across forecast days

      // Find nearby services
      const nearbyServices = this.findNearbyServices(p, 20); // 20km radius

      html += `<div class="route-segment">`;
      html += `<div class="route-segment-header">`;
      html += `<h4><i class="fas fa-${isStart ? 'play-circle' : isEnd ? 'flag-checkered' : 'map-pin'}"
               style="color:${isStart ? 'var(--accent)' : isEnd ? 'var(--danger)' : 'var(--info)'}"></i> ${label}</h4>`;

      if (wxData?.daily) {
        const date = new Date(wxData.daily.time[dayIdx]);
        html += `<span>${date.toLocaleDateString('en-NZ', { weekday: 'short', month: 'short', day: 'numeric' })}</span>`;
      }
      html += '</div>';

      // Weather row
      if (wxData?.daily) {
        const wx = Utils.getWeatherInfo(wxData.daily.weather_code[dayIdx]);
        html += `
          <div class="route-segment-weather">
            <div class="wx-mini">${wx.icon} ${wx.desc}</div>
            <div class="wx-mini"><i class="fas fa-temperature-half"></i> ${Math.round(wxData.daily.temperature_2m_max[dayIdx])}°/${Math.round(wxData.daily.temperature_2m_min[dayIdx])}°</div>
            <div class="wx-mini"><i class="fas fa-droplet"></i> ${wxData.daily.precipitation_sum[dayIdx].toFixed(1)}mm</div>
            <div class="wx-mini"><i class="fas fa-wind"></i> ${Math.round(wxData.daily.wind_speed_10m_max[dayIdx])}m/s</div>
          </div>`;
      }

      // Nearby services
      html += '<div class="route-segment-services">';
      const serviceTypes = [
        { key: 'campsites', icon: 'campground', label: 'Campsites' },
        { key: 'fuel', icon: 'gas-pump', label: 'Fuel' },
        { key: 'water', icon: 'droplet', label: 'Water' },
        { key: 'shops', icon: 'store', label: 'Shops' },
        { key: 'toilets', icon: 'toilet', label: 'Toilets' },
      ];
      for (const svc of serviceTypes) {
        const count = nearbyServices[svc.key] || 0;
        html += `<span class="service-tag ${count > 0 ? 'available' : ''}">
          <i class="fas fa-${svc.icon}"></i> ${count} ${svc.label}
        </span>`;
      }
      html += '</div>';
      html += '</div>';
    }

    html += '</div>';

    // Send to Google Maps button
    const gmapsUrl = this.buildGoogleMapsURL(points);
    html += `
      <div style="margin-top:12px">
        <a href="${gmapsUrl}" target="_blank" class="btn btn-primary btn-block" style="text-align:center">
          <i class="fab fa-google"></i> Open in Google Maps
        </a>
      </div>
    `;

    content.innerHTML = html;
    summary.classList.remove('hidden');
  },

  buildGoogleMapsURL(points) {
    if (points.length < 2) return '#';
    const origin = `${points[0].lat},${points[0].lng}`;
    const dest = `${points[points.length - 1].lat},${points[points.length - 1].lng}`;
    const waypoints = points.slice(1, -1).map(p => `${p.lat},${p.lng}`).join('|');
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`;
    if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
    return url;
  },

  findNearbyServices(latlng, radiusKm) {
    const result = { campsites: 0, fuel: 0, water: 0, shops: 0, toilets: 0 };
    const data = DataLoader.cache;

    const checkFeatures = (features, type) => {
      for (const f of features) {
        const [lon, lat] = f.geometry.coordinates;
        if (Utils.distance(latlng.lat, latlng.lng, lat, lon) <= radiusKm) {
          result[type]++;
        }
      }
    };

    if (data.docCampsites?.features) checkFeatures(data.docCampsites.features, 'campsites');
    if (data.osmCampsites?.features) checkFeatures(data.osmCampsites.features, 'campsites');

    if (data.osmAmenities?.features) {
      for (const f of data.osmAmenities.features) {
        const [lon, lat] = f.geometry.coordinates;
        if (Utils.distance(latlng.lat, latlng.lng, lat, lon) > radiusKm) continue;

        const sub = f.properties.subtype;
        if (sub === 'fuel') result.fuel++;
        else if (sub === 'water') result.water++;
        else if (sub === 'shop') result.shops++;
        else if (sub === 'toilet') result.toilets++;
      }
    }

    return result;
  },

  clearRouteDisplay() {
    if (this.routeControl) {
      this.map.removeControl(this.routeControl);
      this.routeControl = null;
    }
    if (this.routeLine) {
      this.map.removeLayer(this.routeLine);
      this.routeLine = null;
    }
    this.routeMarkers.forEach(m => this.map.removeLayer(m));
    this.routeMarkers = [];
  },

  clearRoute() {
    this.clearRouteDisplay();
    document.getElementById('route-start').value = '';
    document.getElementById('route-start').dataset.lat = '';
    document.getElementById('route-start').dataset.lon = '';
    document.getElementById('route-end').value = '';
    document.getElementById('route-end').dataset.lat = '';
    document.getElementById('route-end').dataset.lon = '';
    document.getElementById('route-waypoints-container').innerHTML = '';
    document.getElementById('route-summary').classList.add('hidden');
  }
};
