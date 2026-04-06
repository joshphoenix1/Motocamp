/* ===== Main App ===== */
(async function () {
  'use strict';

  // ===== Initialize Map =====
  // Home position: updated by geolocation, used by reset button
  let homePosition = { center: [20, 0], zoom: 3 };

  const map = L.map('map', {
    center: homePosition.center,
    zoom: homePosition.zoom,
    minZoom: 2,
    maxZoom: 18,
    zoomControl: false,
  });
  window.map = map;

  // Try to center on user's location
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude, longitude } = pos.coords;
    homePosition = { center: [latitude, longitude], zoom: 10 };
    map.flyTo(homePosition.center, homePosition.zoom, { duration: 1.5 });
  }, () => {}, { enableHighAccuracy: false, timeout: 5000 });

  // Add base tile layer immediately so the map shows
  // Store reference so Layers.setupBasemapSelector can remove it specifically
  window._initialTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  // ===== Load Data =====
  const loadingScreen = document.getElementById('loading-screen');

  // Show the map right away, load data in background, then open dashboard
  setTimeout(() => {
    loadingScreen.classList.add('fade-out');
    setTimeout(() => {
      loadingScreen.style.display = 'none';
      // Auto-open the ride dashboard
      const dashBtn = document.getElementById('btn-dashboard');
      if (dashBtn) dashBtn.click();
    }, 500);
  }, 1500);

  // Initialize route planner immediately (doesn't need data)
  RoutePlanner.init(map);

  // Load data asynchronously
  DataLoader.loadAll((progress, label) => {
    console.log(`Loading: ${label} (${Math.round(progress * 100)}%)`);
  }).then(data => {
    console.log('All data loaded, initializing layers...');
    Layers.init(map, data);
  }).catch(e => {
    console.error('Failed to load data:', e);
    // Still init layers with whatever we have
    Layers.init(map, DataLoader.cache);
  });

  // ===== Search =====
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const searchClear = document.getElementById('search-clear');

  searchInput.addEventListener('input', Utils.debounce(async () => {
    const q = searchInput.value.trim();
    if (q.length < 3) {
      searchResults.classList.add('hidden');
      searchClear.classList.add('hidden');
      return;
    }

    searchClear.classList.remove('hidden');

    try {
      const b = map.getBounds();
      const viewbox = `&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}&bounded=0`;
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}${viewbox}&limit=8`
      );
      const results = await resp.json();

      if (results.length) {
        searchResults.innerHTML = results.map(r => {
          const parts = r.display_name.split(',');
          const shortName = parts.slice(0, 3).join(', ');
          return `<div class="search-result-item" data-lat="${r.lat}" data-lon="${r.lon}">
            <i class="fas fa-map-marker-alt"></i>
            <span>${shortName}</span>
          </div>`;
        }).join('');

        searchResults.classList.remove('hidden');

        searchResults.querySelectorAll('.search-result-item').forEach(item => {
          item.addEventListener('click', () => {
            const lat = parseFloat(item.dataset.lat);
            const lon = parseFloat(item.dataset.lon);
            map.flyTo([lat, lon], 13, { duration: 1.5 });
            searchResults.classList.add('hidden');
            searchInput.value = item.textContent.trim();

            // Add a temporary marker
            const tempMarker = L.marker([lat, lon], {
              icon: L.divIcon({
                className: 'custom-marker',
                html: '<i class="fas fa-map-pin" style="color:#ff5252;font-size:20px"></i>',
                iconSize: [28, 28],
                iconAnchor: [14, 28]
              })
            }).addTo(map);

            setTimeout(() => map.removeLayer(tempMarker), 10000);
          });
        });
      } else {
        searchResults.innerHTML = '<div class="search-result-item"><i class="fas fa-search"></i>No results found</div>';
        searchResults.classList.remove('hidden');
      }
    } catch (e) {
      console.warn('Search failed:', e);
    }
  }, 400));

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchResults.classList.add('hidden');
    searchClear.classList.add('hidden');
  });

  // ===== Sidebar Toggle =====
  const sidebar = document.getElementById('sidebar');
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });
  document.getElementById('sidebar-close').addEventListener('click', () => {
    sidebar.classList.remove('open');
  });

  // ===== Tab Navigation =====
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // ===== Map Controls =====
  // Locate
  const locateBtn = document.getElementById('btn-locate');
  const mobileLocateBtn = document.getElementById('mobile-locate');
  let userLocationMarker = null;

  const doLocate = () => {
    if (!navigator.geolocation) return alert('Geolocation not supported');
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude, longitude } = pos.coords;
      map.flyTo([latitude, longitude], 13, { duration: 1.5 });

      if (userLocationMarker) map.removeLayer(userLocationMarker);
      userLocationMarker = L.marker([latitude, longitude], {
        icon: L.divIcon({
          className: '',
          html: `<div style="width:20px;height:20px;background:rgba(0,150,255,0.3);border-radius:50%;display:flex;align-items:center;justify-content:center">
                   <div style="width:10px;height:10px;background:#0096ff;border-radius:50%;border:2px solid #fff"></div>
                 </div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        })
      }).addTo(map).bindPopup('You are here');
    }, err => {
      console.warn('Geolocation error:', err);
      alert('Could not get your location. Please allow location access.');
    }, { enableHighAccuracy: true, timeout: 10000 });
  };

  locateBtn.addEventListener('click', doLocate);
  mobileLocateBtn.addEventListener('click', doLocate);

  // Reset view
  document.getElementById('btn-reset').addEventListener('click', () => {
    map.flyTo(homePosition.center, homePosition.zoom, { duration: 1.5 });
  });

  // Fullscreen
  document.getElementById('btn-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  });

  // Cell coverage map button
  const cellBtn = document.getElementById('btn-cell-toggle');
  cellBtn.addEventListener('click', () => {
    const sidebarToggle = document.getElementById('cell-all-toggle');
    if (sidebarToggle) {
      sidebarToggle.checked = !sidebarToggle.checked;
      sidebarToggle.dispatchEvent(new Event('change'));
    }
    cellBtn.classList.toggle('active', sidebarToggle?.checked);
  });

  // ===== Right-Click Context Menu =====
  const ctxMenu = document.createElement('div');
  ctxMenu.id = 'context-menu';
  ctxMenu.className = 'hidden';
  ctxMenu.innerHTML = `
    <div class="ctx-item" data-action="directions-from"><i class="fas fa-play"></i> Directions from here</div>
    <div class="ctx-item" data-action="directions-to"><i class="fas fa-flag-checkered"></i> Directions to here</div>
    <div class="ctx-item" data-action="add-waypoint"><i class="fas fa-map-pin"></i> Add as waypoint</div>
    <div class="ctx-divider"></div>
    <div class="ctx-item" data-action="whats-here"><i class="fas fa-info-circle"></i> What's here?</div>
    <div class="ctx-item" data-action="nearby"><i class="fas fa-search-location"></i> Nearby services</div>
  `;
  document.body.appendChild(ctxMenu);

  let ctxLatLng = null;

  map.on('contextmenu', (e) => {
    e.originalEvent.preventDefault();
    ctxLatLng = e.latlng;
    ctxMenu.style.left = e.originalEvent.pageX + 'px';
    ctxMenu.style.top = e.originalEvent.pageY + 'px';
    ctxMenu.classList.remove('hidden');
  });

  document.addEventListener('click', () => ctxMenu.classList.add('hidden'));
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('#map')) ctxMenu.classList.add('hidden');
  });

  ctxMenu.addEventListener('click', async (e) => {
    const item = e.target.closest('.ctx-item');
    if (!item || !ctxLatLng) return;
    const action = item.dataset.action;
    ctxMenu.classList.add('hidden');

    // Switch to route tab for direction actions
    const switchToRoute = () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.querySelector('[data-tab="route"]').classList.add('active');
      document.getElementById('tab-route').classList.add('active');
      if (window.innerWidth <= 768) sidebar.classList.add('open');
    };

    // Reverse geocode the location
    const reverseGeocode = async (lat, lon) => {
      try {
        const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14`);
        const data = await resp.json();
        return data.display_name ? data.display_name.split(',').slice(0, 2).join(',').trim() : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      } catch { return `${lat.toFixed(4)}, ${lon.toFixed(4)}`; }
    };

    if (action === 'directions-from') {
      switchToRoute();
      const name = await reverseGeocode(ctxLatLng.lat, ctxLatLng.lng);
      const input = document.getElementById('route-start');
      input.value = name;
      input.dataset.lat = ctxLatLng.lat;
      input.dataset.lon = ctxLatLng.lng;
      // Auto-plan if both start and end are set
      const endInput = document.getElementById('route-end');
      if (endInput.dataset.lat) document.getElementById('plan-route').click();
    }

    else if (action === 'directions-to') {
      switchToRoute();
      const name = await reverseGeocode(ctxLatLng.lat, ctxLatLng.lng);
      const input = document.getElementById('route-end');
      input.value = name;
      input.dataset.lat = ctxLatLng.lat;
      input.dataset.lon = ctxLatLng.lng;
      // Auto-plan if both start and end are set
      const startInput = document.getElementById('route-start');
      if (startInput.dataset.lat) document.getElementById('plan-route').click();
    }

    else if (action === 'add-waypoint') {
      switchToRoute();
      const name = await reverseGeocode(ctxLatLng.lat, ctxLatLng.lng);
      RoutePlanner.addAsWaypoint(ctxLatLng.lat, ctxLatLng.lng, name);
    }

    else if (action === 'whats-here') {
      const wxData = await Weather.fetchPointWeather(ctxLatLng.lat, ctxLatLng.lng);
      const cellInfo = Layers.findCellCoverage(ctxLatLng.lat, ctxLatLng.lng);
      const nearbyStats = Layers.getNearbyStats(ctxLatLng.lat, ctxLatLng.lng);
      const wxHTML = Weather.buildWeatherHTML(wxData);
      const name = await reverseGeocode(ctxLatLng.lat, ctxLatLng.lng);

      const panel = document.getElementById('info-panel');
      document.getElementById('info-content').innerHTML = `
        <div class="info-header"><h2>${name}</h2><span class="info-type">Location Info</span></div>
        <div class="info-details">
          <div class="info-detail"><div class="info-detail-label">Coordinates</div><div class="info-detail-value">${ctxLatLng.lat.toFixed(4)}, ${ctxLatLng.lng.toFixed(4)}</div></div>
        </div>
        <div style="background:var(--bg-tertiary);border-radius:var(--radius);padding:12px;margin-bottom:16px">
          <h4 style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:8px"><i class="fas fa-map-signs" style="color:var(--accent)"></i> Nearby (20km)</h4>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            <span class="facility-badge ${nearbyStats.campsites > 0 ? 'available' : ''}"><i class="fas fa-campground"></i> ${nearbyStats.campsites} Campsites</span>
            <span class="facility-badge ${nearbyStats.fuel > 0 ? 'available' : ''}"><i class="fas fa-gas-pump"></i> ${nearbyStats.fuel} Fuel</span>
            <span class="facility-badge ${nearbyStats.shops > 0 ? 'available' : ''}"><i class="fas fa-store"></i> ${nearbyStats.shops} Shops</span>
            <span class="facility-badge ${nearbyStats.water > 0 ? 'available' : ''}"><i class="fas fa-droplet"></i> ${nearbyStats.water} Water</span>
            <span class="facility-badge ${nearbyStats.toilets > 0 ? 'available' : ''}"><i class="fas fa-toilet"></i> ${nearbyStats.toilets} Toilets</span>
          </div>
        </div>
        <div class="info-cell-coverage">
          <h4 style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:8px"><i class="fas fa-signal" style="color:var(--accent)"></i> Cell Coverage</h4>
          ${Layers.buildCellCoverageHTML(cellInfo)}
        </div>
        <div class="info-weather"><h4><i class="fas fa-cloud-sun"></i> 7-Day Forecast</h4>${wxHTML}</div>
        <div class="info-actions">
          <a href="https://www.google.com/maps/dir/?api=1&destination=${ctxLatLng.lat},${ctxLatLng.lng}" target="_blank" class="btn btn-sm"><i class="fas fa-directions"></i> Navigate</a>
        </div>
      `;
      panel.classList.remove('hidden');
    }

    else if (action === 'nearby') {
      // Zoom in and enable all service layers
      map.flyTo(ctxLatLng, 13, { duration: 1 });
      ['toilets', 'water', 'shelters', 'fuel', 'shops'].forEach(layer => {
        const cb = document.querySelector(`[data-layer="${layer}"]`);
        if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
      });
    }
  });

  // ===== Info Panel Close =====
  document.getElementById('info-close').addEventListener('click', () => {
    document.getElementById('info-panel').classList.add('hidden');
  });

  // ===== Map Click: close info panel + weather =====
  map.on('click', async (e) => {
    // Close info panel on any map click
    if (!Layers.activeWeatherType) {
      document.getElementById('info-panel').classList.add('hidden');
    }

    // If weather overlay is active, show point weather
    if (Layers.activeWeatherType) {
      const weatherInfo = document.getElementById('weather-point-info');
      const weatherContent = document.getElementById('weather-point-content');

      weatherContent.innerHTML = '<p style="color:var(--text-muted)">Loading weather...</p>';
      weatherInfo.classList.remove('hidden');

      const wxData = await Weather.fetchPointWeather(e.latlng.lat, e.latlng.lng);
      if (wxData) {
        const hourIdx = Weather.currentHourOffset || 0;
        const h = wxData.hourly;

        if (h) {
          const wx = Utils.getWeatherInfo(h.weather_code?.[hourIdx] || 0);
          weatherContent.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <span style="font-size:1.5rem">${wx.icon}</span>
              <span style="font-size:1.1rem;font-weight:600">${Math.round(h.temperature_2m?.[hourIdx] || 0)}°C</span>
              <span style="color:var(--text-muted)">${wx.desc}</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:0.8rem">
              <div><i class="fas fa-wind" style="color:var(--accent);width:16px"></i> ${Math.round(h.wind_speed_10m?.[hourIdx] || 0)} m/s</div>
              <div><i class="fas fa-droplet" style="color:var(--info);width:16px"></i> ${(h.precipitation?.[hourIdx] || 0).toFixed(1)} mm</div>
              <div><i class="fas fa-cloud" style="color:var(--text-muted);width:16px"></i> ${h.cloud_cover?.[hourIdx] || 0}%</div>
              <div><i class="fas fa-tint" style="color:var(--info);width:16px"></i> ${h.relative_humidity_2m?.[hourIdx] || 0}% humidity</div>
            </div>
            <div style="margin-top:8px;font-size:0.72rem;color:var(--text-muted)">
              ${e.latlng.lat.toFixed(3)}, ${e.latlng.lng.toFixed(3)}
            </div>
          `;
        }
      }
    }
  });

  // ===== Add to Route from Info Panel =====
  RoutePlanner.addAsWaypoint = function (lat, lon, name) {
    const container = document.getElementById('route-waypoints-container');
    const div = document.createElement('div');
    div.className = 'route-point';
    div.innerHTML = `
      <i class="fas fa-circle route-waypoint-icon"></i>
      <input type="text" class="route-waypoint-input" value="${name}" autocomplete="off"
             data-lat="${lat}" data-lon="${lon}" />
      <button class="btn btn-sm" onclick="this.parentElement.remove()" style="padding:4px;border:none;">
        <i class="fas fa-times" style="color:var(--text-muted)"></i>
      </button>
    `;
    container.appendChild(div);

    // Switch to route tab
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="route"]').classList.add('active');
    document.getElementById('tab-route').classList.add('active');

    // Close info panel
    document.getElementById('info-panel').classList.add('hidden');

    // Open sidebar on mobile
    if (window.innerWidth <= 768) {
      document.getElementById('sidebar').classList.add('open');
    }
  };

  // ===== Generate Weather Timeline Labels =====
  const timelineLabels = document.getElementById('weather-timeline-labels');
  const now = new Date();
  for (let h = 0; h <= 168; h += 24) {
    const d = new Date(now);
    d.setHours(d.getHours() + h);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const span = document.createElement('span');
    span.textContent = h === 0 ? 'Now' : dayNames[d.getDay()];
    timelineLabels.appendChild(span);
  }

  // ===== Keyboard shortcuts =====
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.getElementById('info-panel').classList.add('hidden');
      searchResults.classList.add('hidden');
      if (window.innerWidth <= 768) sidebar.classList.remove('open');
    }
    // Ctrl+K for search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
    }
  });

  // ===== Handle window resize =====
  window.addEventListener('resize', () => {
    map.invalidateSize();
  });

  // ===== Health Check =====
  HealthCheck.start(map);

  // ===== Service Worker =====
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      console.log('[SW] Registered:', reg.scope);
    }).catch(err => console.warn('[SW] Registration failed:', err));
  }

  console.log('Long Way Home initialized successfully!');
})();
