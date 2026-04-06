/* ===== Route Planning Module ===== */
const RoutePlanner = {
  waypoints: [],
  routeControl: null,
  routeMarkers: [],
  routeLine: null,
  gravelOverlays: [],
  elevationMarker: null,

  init(map) {
    this.map = map;
    this.setupEventListeners();
    this.loadSavedRoutes();
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

    // Save route button
    document.getElementById('save-route').addEventListener('click', () => this.saveRoute());

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
        const b = this.map.getBounds();
        const viewbox = `&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}&bounded=0`;
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}${viewbox}&limit=5`
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
        const b = this.map.getBounds();
        const viewbox = `&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}&bounded=0`;
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}${viewbox}&limit=5`
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
        routeWhileDragging: true,
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
        addWaypoints: true,
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

        // Highlight gravel segments
        this.clearGravelOverlays();
        if (typeof GravelRoads !== 'undefined' && route.coordinates) {
          this.highlightGravelSegments(route.coordinates);
        }

        await this.generateRouteSummary(route, allPoints, altRoutes, route.coordinates);
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

  async generateRouteSummary(route, points, altRoutes, routeCoords) {
    const summary = document.getElementById('route-summary');
    const content = document.getElementById('route-summary-content');

    const totalKm = (route.summary.totalDistance / 1000).toFixed(0);
    const totalHours = (route.summary.totalTime / 3600);

    const gravelActive = document.getElementById('gravel-bias')?.checked;

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

    // Route color legend
    if (gravelActive) {
      html += `<div style="display:flex;gap:12px;align-items:center;margin-bottom:10px;font-size:0.75rem;color:var(--text-secondary)">
        <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:20px;height:3px;background:#ff1744;display:inline-block;border-radius:2px"></span> Sealed</span>
        <span style="display:inline-flex;align-items:center;gap:4px"><span style="width:20px;height:0;border-top:3px dashed #D2691E;display:inline-block"></span> Gravel</span>
      </div>`;
    }

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
        html += `<span>${date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>`;
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

    // Fetch and render elevation profile
    if (routeCoords && routeCoords.length > 1) {
      const elData = await this.fetchElevationData(routeCoords);
      if (elData) {
        this.lastElevationData = elData; // expose for dashboard sparkline
        // Insert elevation profile after route overview
        const overviewEl = content.querySelector('.route-overview');
        const insertTarget = overviewEl ? overviewEl.nextSibling : content.firstChild;
        const elContainer = document.createElement('div');
        content.insertBefore(elContainer, insertTarget);
        this.renderElevationProfile(elData, elContainer);
      }
    }
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

  // Fetch elevation data for route coordinates using Open-Meteo
  async fetchElevationData(routeCoords) {
    // Sample coordinates - Open-Meteo accepts up to 100 per request
    const MAX_POINTS = 150;
    const step = Math.max(1, Math.floor(routeCoords.length / MAX_POINTS));
    const sampled = [];
    for (let i = 0; i < routeCoords.length; i += step) {
      sampled.push(routeCoords[i]);
    }
    // Always include last point
    if (sampled[sampled.length - 1] !== routeCoords[routeCoords.length - 1]) {
      sampled.push(routeCoords[routeCoords.length - 1]);
    }

    // Calculate cumulative distances for each sampled point
    const distances = [0];
    for (let i = 1; i < sampled.length; i++) {
      const d = Utils.distance(sampled[i - 1].lat, sampled[i - 1].lng, sampled[i].lat, sampled[i].lng);
      distances.push(distances[i - 1] + d);
    }

    // Batch requests (Open-Meteo allows ~100 coords per request)
    const BATCH = 100;
    const elevations = [];
    for (let i = 0; i < sampled.length; i += BATCH) {
      const batch = sampled.slice(i, i + BATCH);
      const lats = batch.map(c => c.lat.toFixed(4)).join(',');
      const lons = batch.map(c => c.lng.toFixed(4)).join(',');
      try {
        const resp = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`);
        const data = await resp.json();
        if (data.elevation) {
          elevations.push(...data.elevation);
        }
      } catch (e) {
        console.warn('Elevation fetch failed:', e);
        return null;
      }
    }

    if (elevations.length !== sampled.length) return null;

    // Calculate gain/loss
    let gain = 0, loss = 0;
    for (let i = 1; i < elevations.length; i++) {
      const diff = elevations[i] - elevations[i - 1];
      if (diff > 0) gain += diff;
      else loss += Math.abs(diff);
    }

    return {
      points: sampled,
      distances,
      elevations,
      totalDistance: distances[distances.length - 1],
      gain: Math.round(gain),
      loss: Math.round(loss),
      min: Math.round(Math.min(...elevations)),
      max: Math.round(Math.max(...elevations))
    };
  },

  renderElevationProfile(elData, container) {
    const wrapper = document.createElement('div');
    wrapper.className = 'elevation-profile';
    wrapper.innerHTML = `
      <h4 style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:8px">
        <i class="fas fa-mountain" style="color:var(--accent)"></i> Elevation Profile
      </h4>
      <div class="elevation-stats">
        <span><i class="fas fa-arrow-up" style="color:#00c853"></i> ${elData.gain}m gain</span>
        <span><i class="fas fa-arrow-down" style="color:#ff5252"></i> ${elData.loss}m loss</span>
        <span><i class="fas fa-mountain"></i> ${elData.max}m max</span>
      </div>
      <div class="elevation-chart-wrap">
        <canvas id="elevation-canvas" height="120"></canvas>
        <div class="elevation-tooltip hidden" id="elevation-tooltip"></div>
      </div>
    `;
    container.appendChild(wrapper);

    const canvas = document.getElementById('elevation-canvas');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Size canvas to container
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.style.width = rect.width + 'px';
    canvas.style.height = '120px';
    canvas.width = rect.width * dpr;
    canvas.height = 120 * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = 120;
    const PAD = { top: 8, right: 8, bottom: 22, left: 42 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    const { distances, elevations, totalDistance } = elData;
    const minElev = Math.min(...elevations) - 20;
    const maxElev = Math.max(...elevations) + 20;
    const elevRange = maxElev - minElev || 1;

    const toX = (d) => PAD.left + (d / totalDistance) * plotW;
    const toY = (e) => PAD.top + plotH - ((e - minElev) / elevRange) * plotH;

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    const gridSteps = 4;
    for (let i = 0; i <= gridSteps; i++) {
      const y = PAD.top + (plotH / gridSteps) * i;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(W - PAD.right, y);
      ctx.stroke();

      // Y-axis labels
      const elev = maxElev - (elevRange / gridSteps) * i;
      ctx.fillStyle = '#5a6f82';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(elev) + 'm', PAD.left - 4, y + 3);
    }

    // X-axis labels
    ctx.textAlign = 'center';
    const xSteps = Math.min(5, Math.floor(totalDistance / 10));
    for (let i = 0; i <= xSteps; i++) {
      const d = (totalDistance / xSteps) * i;
      const x = toX(d);
      ctx.fillStyle = '#5a6f82';
      ctx.fillText(Math.round(d) + 'km', x, H - 4);
    }

    // Fill gradient
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + plotH);
    grad.addColorStop(0, 'rgba(0, 200, 83, 0.35)');
    grad.addColorStop(1, 'rgba(0, 200, 83, 0.02)');

    ctx.beginPath();
    ctx.moveTo(toX(distances[0]), PAD.top + plotH);
    for (let i = 0; i < distances.length; i++) {
      ctx.lineTo(toX(distances[i]), toY(elevations[i]));
    }
    ctx.lineTo(toX(distances[distances.length - 1]), PAD.top + plotH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(toX(distances[0]), toY(elevations[0]));
    for (let i = 1; i < distances.length; i++) {
      ctx.lineTo(toX(distances[i]), toY(elevations[i]));
    }
    ctx.strokeStyle = '#00c853';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Hover interaction
    const tooltip = document.getElementById('elevation-tooltip');
    const self = this;

    canvas.addEventListener('mousemove', (e) => {
      const cRect = canvas.getBoundingClientRect();
      const mx = e.clientX - cRect.left;
      const distAtMouse = ((mx - PAD.left) / plotW) * totalDistance;

      if (distAtMouse < 0 || distAtMouse > totalDistance) {
        tooltip.classList.add('hidden');
        if (self.elevationMarker) { self.map.removeLayer(self.elevationMarker); self.elevationMarker = null; }
        return;
      }

      // Find closest point
      let closest = 0;
      for (let i = 1; i < distances.length; i++) {
        if (Math.abs(distances[i] - distAtMouse) < Math.abs(distances[closest] - distAtMouse)) {
          closest = i;
        }
      }

      const elev = elevations[closest];
      const pt = elData.points[closest];
      const x = toX(distances[closest]);
      const y = toY(elev);

      // Draw crosshair
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Redraw (simple approach: just re-render the static parts aren't changing, so use overlay)
      // Instead, use a simpler approach with tooltip positioning
      tooltip.innerHTML = `<strong>${Math.round(elev)}m</strong><br>${distances[closest].toFixed(1)}km`;
      tooltip.style.left = (mx - 30) + 'px';
      tooltip.style.top = (y - 40) + 'px';
      tooltip.classList.remove('hidden');

      // Show marker on map
      if (self.elevationMarker) self.map.removeLayer(self.elevationMarker);
      self.elevationMarker = L.circleMarker([pt.lat, pt.lng], {
        radius: 6, color: '#00c853', fillColor: '#00c853', fillOpacity: 1, weight: 2
      }).addTo(self.map);
      self.elevationMarker.bindTooltip(`${Math.round(elev)}m`, { permanent: true, direction: 'top', className: 'elevation-map-tooltip' }).openTooltip();
    });

    canvas.addEventListener('mouseleave', () => {
      tooltip.classList.add('hidden');
      if (self.elevationMarker) { self.map.removeLayer(self.elevationMarker); self.elevationMarker = null; }
    });

    canvas.addEventListener('click', (e) => {
      const cRect = canvas.getBoundingClientRect();
      const mx = e.clientX - cRect.left;
      const distAtMouse = ((mx - PAD.left) / plotW) * totalDistance;
      if (distAtMouse < 0 || distAtMouse > totalDistance) return;

      let closest = 0;
      for (let i = 1; i < distances.length; i++) {
        if (Math.abs(distances[i] - distAtMouse) < Math.abs(distances[closest] - distAtMouse)) closest = i;
      }
      const pt = elData.points[closest];
      self.map.panTo([pt.lat, pt.lng]);
    });
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
    if (this.elevationMarker) { this.map.removeLayer(this.elevationMarker); this.elevationMarker = null; }
    this.clearGravelOverlays();
  },

  // Classify route coordinates as gravel or sealed
  classifyRouteSegments(routeCoords) {
    const THRESHOLD_KM = 0.5;
    const allGravelPts = GravelRoads.roads.flatMap(r => r.points);

    const classified = routeCoords.map(coord => {
      const isGravel = allGravelPts.some(([lat, lon]) =>
        Utils.distance(coord.lat, coord.lng, lat, lon) < THRESHOLD_KM
      );
      return { coord, isGravel };
    });

    // Group into contiguous segments
    const segments = [];
    let current = { isGravel: classified[0].isGravel, coords: [classified[0].coord] };

    for (let i = 1; i < classified.length; i++) {
      if (classified[i].isGravel === current.isGravel) {
        current.coords.push(classified[i].coord);
      } else {
        current.coords.push(classified[i].coord); // overlap for continuity
        segments.push(current);
        current = { isGravel: classified[i].isGravel, coords: [classified[i].coord] };
      }
    }
    segments.push(current);
    return segments;
  },

  // Draw gravel segments in brown/orange over the route
  highlightGravelSegments(routeCoords) {
    const segments = this.classifyRouteSegments(routeCoords);

    for (const seg of segments) {
      if (seg.isGravel && seg.coords.length >= 2) {
        const overlay = L.polyline(seg.coords, {
          color: '#D2691E',
          weight: 6,
          opacity: 0.9,
          dashArray: '8, 4',
          interactive: false
        }).addTo(this.map);
        this.gravelOverlays.push(overlay);
      }
    }
  },

  clearGravelOverlays() {
    if (this.gravelOverlays) {
      this.gravelOverlays.forEach(layer => this.map.removeLayer(layer));
      this.gravelOverlays = [];
    }
  },

  clearRoute() {
    this.clearRouteDisplay();
    this.lastElevationData = null;
    document.getElementById('route-start').value = '';
    document.getElementById('route-start').dataset.lat = '';
    document.getElementById('route-start').dataset.lon = '';
    document.getElementById('route-end').value = '';
    document.getElementById('route-end').dataset.lat = '';
    document.getElementById('route-end').dataset.lon = '';
    document.getElementById('route-waypoints-container').innerHTML = '';
    document.getElementById('route-summary').classList.add('hidden');
  },

  saveRoute() {
    const startInput = document.getElementById('route-start');
    const endInput = document.getElementById('route-end');

    if (!startInput.dataset.lat || !endInput.dataset.lat) {
      alert('Plan a route first before saving.');
      return;
    }

    const name = prompt('Enter a name for this route:');
    if (!name) return;

    // Collect waypoint data
    const waypointInputs = document.querySelectorAll('.route-waypoint-input');
    const waypoints = [];
    waypointInputs.forEach(inp => {
      if (inp.dataset.lat) {
        waypoints.push({
          name: inp.value,
          lat: inp.dataset.lat,
          lon: inp.dataset.lon
        });
      }
    });

    const route = {
      name,
      start: { name: startInput.value, lat: startInput.dataset.lat, lon: startInput.dataset.lon },
      end: { name: endInput.value, lat: endInput.dataset.lat, lon: endInput.dataset.lon },
      waypoints,
      gravelBias: document.getElementById('gravel-bias')?.checked || false,
      timestamp: Date.now()
    };

    const saved = JSON.parse(localStorage.getItem('motocamp-routes') || '[]');
    saved.push(route);
    localStorage.setItem('motocamp-routes', JSON.stringify(saved));
    this.loadSavedRoutes();
  },

  loadSavedRoutes() {
    const list = document.getElementById('saved-routes-list');
    if (!list) return;

    const saved = JSON.parse(localStorage.getItem('motocamp-routes') || '[]');

    if (saved.length === 0) {
      list.innerHTML = '<p style="font-size:0.78rem;color:var(--text-muted)">No saved routes yet.</p>';
      return;
    }

    list.innerHTML = saved.map((route, i) => {
      const date = new Date(route.timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
      const startShort = route.start.name.split(',')[0];
      const endShort = route.end.name.split(',')[0];
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:var(--bg-tertiary);border-radius:var(--radius-sm);margin-bottom:6px">
        <div style="flex:1;min-width:0">
          <div style="font-size:0.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${route.name}</div>
          <div style="font-size:0.7rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${startShort} → ${endShort}</div>
          <div style="font-size:0.65rem;color:var(--text-muted)">${date}</div>
        </div>
        <button class="btn btn-sm" onclick="RoutePlanner.loadRoute(${i})" style="flex-shrink:0"><i class="fas fa-upload"></i> Load</button>
        <button onclick="RoutePlanner.deleteRoute(${i})" style="flex-shrink:0;background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.85rem;padding:4px" title="Delete"><i class="fas fa-times"></i></button>
      </div>`;
    }).join('');
  },

  loadRoute(index) {
    const saved = JSON.parse(localStorage.getItem('motocamp-routes') || '[]');
    const route = saved[index];
    if (!route) return;

    // Set start
    const startInput = document.getElementById('route-start');
    startInput.value = route.start.name;
    startInput.dataset.lat = route.start.lat;
    startInput.dataset.lon = route.start.lon;

    // Set end
    const endInput = document.getElementById('route-end');
    endInput.value = route.end.name;
    endInput.dataset.lat = route.end.lat;
    endInput.dataset.lon = route.end.lon;

    // Clear and re-add waypoints
    const container = document.getElementById('route-waypoints-container');
    container.innerHTML = '';
    if (route.waypoints && route.waypoints.length > 0) {
      route.waypoints.forEach(wp => {
        this.addWaypointInput();
        const inputs = container.querySelectorAll('.route-waypoint-input');
        const lastInput = inputs[inputs.length - 1];
        lastInput.value = wp.name;
        lastInput.dataset.lat = wp.lat;
        lastInput.dataset.lon = wp.lon;
      });
    }

    // Set gravel toggle
    const gravelToggle = document.getElementById('gravel-bias');
    if (gravelToggle) {
      gravelToggle.checked = route.gravelBias || false;
    }

    this.planRoute();
  },

  deleteRoute(index) {
    const saved = JSON.parse(localStorage.getItem('motocamp-routes') || '[]');
    saved.splice(index, 1);
    localStorage.setItem('motocamp-routes', JSON.stringify(saved));
    this.loadSavedRoutes();
  }
};
