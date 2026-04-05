// ===== GPS Dashboard - Speedometer, Altitude & Compass Arrow =====
(function() {
  'use strict';

  const TARGET_STORAGE_KEY = 'motocamp-compass-target';

  let watchId = null;
  let maxSpeed = 0;
  let orientationListener = null;
  let screenOrientationListener = null;
  let wakeLock = null;
  let gpsStatus = 'waiting'; // waiting, active, error
  let lastGpsTime = 0;
  let compassHeading = null; // device compass fallback
  let gpsHeading = null;
  let lastGpsSpeed = 0;
  let gpsCheckInterval = null;

  // Trip odometer
  let tripDistance = 0; // meters
  let lastPosition = null;

  // Gradient
  let lastGradientAlt = null;
  let lastGradientDist = 0;
  let currentGradient = 0;

  // Temperature
  let currentTemp = null;
  let lastTempFetch = 0;

  // Average speed
  let tripStartTime = null;

  // Compass target destination
  let compassTarget = null; // { lat, lng, name }
  let currentLat = null, currentLng = null;
  let currentHeading = null; // combined best heading (gps or compass)
  let geocodeTimer = null;
  let smoothedArrowRot = null; // EMA-smoothed arrow rotation in degrees

  function loadCompassTarget() {
    try {
      const raw = localStorage.getItem(TARGET_STORAGE_KEY);
      if (raw) compassTarget = JSON.parse(raw);
    } catch (e) { compassTarget = null; }
  }

  function saveCompassTarget() {
    try {
      if (compassTarget) localStorage.setItem(TARGET_STORAGE_KEY, JSON.stringify(compassTarget));
      else localStorage.removeItem(TARGET_STORAGE_KEY);
    } catch (e) { /* ignore */ }
  }


  function initDashboard() {
    const btn = document.getElementById('btn-dashboard');
    const mobileBtn = document.getElementById('mobile-dashboard');
    const closeBtn = document.getElementById('dashboard-close');

    if (btn) btn.addEventListener('click', openDashboard);
    if (mobileBtn) mobileBtn.addEventListener('click', openDashboard);
    if (closeBtn) closeBtn.addEventListener('click', closeDashboard);
  }

  function openDashboard() {
    // Request GPS permission first — this triggers the browser prompt
    if (!navigator.geolocation) {
      alert('GPS is not supported on this device.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function() { startDashboard(); },
      function(err) {
        if (err.code === 1) {
          alert('Location permission is required for the ride dashboard.\n\nPlease enable Location in your browser settings and try again.');
        } else {
          // Permission granted but other error (timeout etc) — open anyway
          startDashboard();
        }
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function startDashboard(preserveStats) {
    try {
      const overlay = document.getElementById('dashboard-overlay');
      overlay.classList.remove('hidden');
      overlay.style.display = 'flex';

      const btn = document.getElementById('btn-dashboard');
      if (btn) btn.classList.add('active');

      document.body.classList.add('dashboard-active');
      requestWakeLock();

      try {
        const el = document.documentElement;
        if (el.requestFullscreen) {
          el.requestFullscreen().catch(() => {});
        } else if (el.webkitRequestFullscreen) {
          el.webkitRequestFullscreen();
        }
      } catch (e) { /* ignore */ }

      // Reset stats (unless we're resuming — e.g. after a map-pick side trip)
      if (!preserveStats) {
        maxSpeed = 0;
        tripDistance = 0;
        lastPosition = null;
        lastGradientAlt = null;
        lastGradientDist = 0;
        currentGradient = 0;
        currentTemp = null;
        lastTempFetch = 0;
        tripStartTime = null;
        updateDisplay(0, null, null);
      }
      gpsStatus = 'waiting';
      updateGpsStatus('waiting');
      updateStatsStrip();

      // Start GPS tracking
      watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000
      });

      // Monitor GPS health — if no update in 5s, show warning
      gpsCheckInterval = setInterval(() => {
        if (gpsStatus === 'active' && Date.now() - lastGpsTime > 5000) {
          updateGpsStatus('stale');
        }
      }, 2000);

      // Start compass for heading
      if (window.DeviceOrientationEvent) {
        orientationListener = onDeviceOrientation;
        window.addEventListener('deviceorientation', orientationListener);
      }

      // Load saved target and wire up UI
      loadCompassTarget();
      setupCompassUI();
      renderCompassTarget();
      updateCompassArrow();

      // Watch for phone orientation flips (portrait ↔ landscape)
      screenOrientationListener = onScreenOrientationChange;
      window.addEventListener('orientationchange', screenOrientationListener);
      window.addEventListener('resize', screenOrientationListener);
    } catch (e) {
      console.error('Dashboard open error:', e);
    }
  }

  function closeDashboard() {
    try {
      const overlay = document.getElementById('dashboard-overlay');
      overlay.classList.add('hidden');
      overlay.style.display = 'none';

      const btn = document.getElementById('btn-dashboard');
      if (btn) btn.classList.remove('active');

      document.body.classList.remove('dashboard-active');

      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      if (orientationListener) {
        window.removeEventListener('deviceorientation', orientationListener);
        orientationListener = null;
      }
      if (screenOrientationListener) {
        window.removeEventListener('orientationchange', screenOrientationListener);
        window.removeEventListener('resize', screenOrientationListener);
        screenOrientationListener = null;
      }
      if (gpsCheckInterval) {
        clearInterval(gpsCheckInterval);
        gpsCheckInterval = null;
      }

      releaseWakeLock();

      try {
        const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
        if (fsEl) {
          (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        }
      } catch (e) { /* ignore */ }
    } catch (e) {
      console.error('Dashboard close error:', e);
    }
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch (e) { /* ignore */ }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && watchId !== null) {
      requestWakeLock();
    }
  });

  function updateGpsStatus(status, msg) {
    gpsStatus = status === 'stale' ? 'active' : status; // keep internal state
    const el = document.getElementById('dash-gps-status');
    const textEl = document.getElementById('dash-gps-text');
    if (!el || !textEl) return;

    el.className = 'dash-gps-status';
    switch (status) {
      case 'waiting':
        el.classList.add('gps-waiting');
        textEl.textContent = 'Waiting for GPS...';
        break;
      case 'active':
        el.classList.add('gps-active');
        textEl.textContent = 'GPS Connected';
        break;
      case 'stale':
        el.classList.add('gps-stale');
        textEl.textContent = 'GPS Signal Lost...';
        break;
      case 'error':
        el.classList.add('gps-error');
        textEl.textContent = msg || 'GPS Error';
        break;
    }
  }

  function onPosition(pos) {
    const { latitude, longitude, speed, altitude, heading } = pos.coords;
    lastGpsTime = Date.now();
    updateGpsStatus('active');
    currentLat = latitude;
    currentLng = longitude;

    let speedKmh = 0;
    if (speed !== null && speed >= 0) {
      speedKmh = speed * 3.6;
    }
    if (speedKmh > maxSpeed) maxSpeed = speedKmh;

    // Trip odometer — accumulate distance between GPS fixes
    if (!tripStartTime) tripStartTime = Date.now();
    if (lastPosition) {
      const d = haversine(lastPosition.lat, lastPosition.lng, latitude, longitude);
      if (d > 3) { // ignore GPS jitter < 3m
        tripDistance += d;

        // Gradient — calculate over distance chunks
        if (altitude !== null && lastGradientAlt !== null) {
          const segDist = tripDistance - lastGradientDist;
          if (segDist > 50) { // recalculate every 50m
            const rise = altitude - lastGradientAlt;
            currentGradient = (rise / segDist) * 100;
            lastGradientAlt = altitude;
            lastGradientDist = tripDistance;
          }
        } else if (altitude !== null) {
          lastGradientAlt = altitude;
          lastGradientDist = tripDistance;
        }
      }
    }
    lastPosition = { lat: latitude, lng: longitude };

    const alt = altitude !== null ? Math.round(altitude) : null;

    // Fetch temperature every 5 minutes
    const now = Date.now();
    if (now - lastTempFetch > 5 * 60 * 1000) {
      lastTempFetch = now;
      fetchTemperature(latitude, longitude);
    }

    // GPS heading is reliable when moving (>5 km/h)
    lastGpsSpeed = speedKmh;
    if (heading !== null && speedKmh > 5) {
      gpsHeading = heading;
    }

    // Use GPS heading when moving, compass when stationary
    const bestHeading = (speedKmh > 5 && gpsHeading !== null) ? gpsHeading : compassHeading;
    currentHeading = bestHeading;
    const hdg = bestHeading !== null ? Math.round(bestHeading) : null;
    updateDisplay(speedKmh, alt, hdg);
    updateStatsStrip();
    updateCompassArrow();
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function fetchTemperature(lat, lon) {
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`)
      .then(r => r.json())
      .then(data => {
        if (data.current_weather) {
          currentTemp = Math.round(data.current_weather.temperature);
          updateStatsStrip();
        }
      })
      .catch(() => {});
  }

  function updateStatsStrip() {
    const tempEl = document.getElementById('dash-temp-value');
    const tripEl = document.getElementById('dash-trip-value');
    const gradEl = document.getElementById('dash-gradient-value');
    const avgEl = document.getElementById('dash-avg-speed-value');

    if (tempEl) tempEl.textContent = currentTemp !== null ? currentTemp : '--';
    if (tripEl) tripEl.textContent = (tripDistance / 1000).toFixed(1);
    if (gradEl) gradEl.textContent = Math.round(currentGradient);
    if (avgEl && tripStartTime) {
      const hours = (Date.now() - tripStartTime) / 3600000;
      const avgKmh = hours > 0 ? (tripDistance / 1000) / hours : 0;
      avgEl.textContent = Math.round(avgKmh);
    }
    const topEl = document.getElementById('dash-top-speed-value');
    if (topEl) topEl.textContent = Math.round(maxSpeed);
  }

  function onGeoError(err) {
    console.warn('Dashboard GPS error:', err.message);
    if (err.code === 1) {
      updateGpsStatus('error', 'GPS Permission Denied');
    } else if (err.code === 2) {
      updateGpsStatus('error', 'GPS Unavailable');
    } else {
      updateGpsStatus('error', 'GPS Timeout');
    }
  }

  function onDeviceOrientation(event) {
    let heading = null;

    // Use webkitCompassHeading if available (iOS) — already true north
    if (event.webkitCompassHeading !== undefined) {
      heading = event.webkitCompassHeading;
    } else if (event.alpha !== null) {
      // Android: alpha is degrees from compass north (0-360)
      // Adjust for landscape orientation using screen.orientation
      heading = 360 - event.alpha;
      const orientation = (screen.orientation || {}).angle || window.orientation || 0;
      heading = (heading + orientation) % 360;
    }

    if (heading !== null) {
      compassHeading = heading;
      // Update display with compass heading when stationary
      if (lastGpsSpeed <= 5) {
        currentHeading = heading;
        const hdg = Math.round(heading);
        const headingEl = document.getElementById('dash-heading-value');
        if (headingEl) {
          const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
          const idx = Math.round(hdg / 45) % 8;
          headingEl.textContent = `${dirs[idx]} ${hdg}°`;
        }
        updateCompassArrow();
      }
    }
  }

  function updateDisplay(speedKmh, altitude, heading) {
    const speedVal = document.getElementById('dash-speed-value');
    const maxSpeedEl = document.getElementById('dash-max-speed');
    if (speedVal) speedVal.textContent = Math.round(speedKmh);
    if (maxSpeedEl) maxSpeedEl.textContent = Math.round(maxSpeed);

    const altEl = document.getElementById('dash-altitude-value');
    if (altEl) altEl.textContent = altitude !== null ? altitude : '--';

    const headingEl = document.getElementById('dash-heading-value');
    if (headingEl) {
      if (heading !== null) {
        const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const idx = Math.round(heading / 45) % 8;
        headingEl.textContent = `${dirs[idx]} ${heading}°`;
      } else {
        headingEl.textContent = '--';
      }
    }
  }

  // ===== Compass Arrow to Destination =====

  function bearingTo(lat1, lon1, lat2, lon2) {
    const toRad = x => x * Math.PI / 180;
    const toDeg = x => x * 180 / Math.PI;
    const φ1 = toRad(lat1), φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function renderCompassTarget() {
    const nameEl = document.getElementById('dash-compass-target');
    const arrow = document.getElementById('dash-compass-arrow');
    if (nameEl) {
      nameEl.textContent = compassTarget ? compassTarget.name : 'Tap to set destination';
    }
    if (arrow) {
      arrow.classList.toggle('no-target', !compassTarget);
    }
  }

  function updateCompassArrow() {
    const arrow = document.getElementById('dash-compass-arrow');
    const distEl = document.getElementById('dash-compass-dist');
    const brgEl = document.getElementById('dash-compass-bearing');
    if (!arrow) return;

    if (!compassTarget || currentLat === null || currentLng === null) {
      if (distEl) distEl.textContent = '--';
      if (brgEl) brgEl.textContent = '--';
      return;
    }

    const brg = bearingTo(currentLat, currentLng, compassTarget.lat, compassTarget.lng);
    const distM = haversine(currentLat, currentLng, compassTarget.lat, compassTarget.lng);
    const distKm = distM / 1000;

    if (distEl) distEl.textContent = distKm >= 10 ? Math.round(distKm) : distKm.toFixed(1);
    if (brgEl) brgEl.textContent = Math.round(brg);

    // Rotate arrow relative to current heading so "up" = ahead
    const rawRot = currentHeading !== null ? ((brg - currentHeading + 360) % 360) : brg;

    // 5-period EMA smoothing. Keep the rotation UNWRAPPED (cumulative) so that
    // CSS rotate() always travels the short way — e.g. 358° → 362° instead of
    // 358° → 2° (which would spin 356° the long way).
    const alpha = 2 / (5 + 1); // ≈ 0.333
    if (smoothedArrowRot === null) {
      smoothedArrowRot = rawRot;
    } else {
      // shortest signed delta relative to current (unwrapped) smoothed value
      const wrapped = ((smoothedArrowRot % 360) + 360) % 360;
      const delta = ((rawRot - wrapped + 540) % 360) - 180;
      smoothedArrowRot += alpha * delta;
    }
    arrow.style.transform = `rotate(${smoothedArrowRot}deg)`;
  }

  let orientationDebounce = null;
  function onScreenOrientationChange() {
    // Debounce — some browsers fire resize many times during a flip
    clearTimeout(orientationDebounce);
    orientationDebounce = setTimeout(() => {
      // Re-prime EMA so the arrow snaps to the corrected angle cleanly
      smoothedArrowRot = null;
      // Force re-read of screen.orientation.angle in compass calc on next event;
      // meanwhile repaint with whatever heading we have
      updateCompassArrow();
    }, 150);
  }

  // ===== Compass destination UI (address + map pick) =====

  function setupCompassUI() {
    const zone = document.getElementById('dash-compass-zone');
    const panel = document.getElementById('dash-compass-input');
    const input = document.getElementById('dash-compass-address');
    const results = document.getElementById('dash-compass-results');
    const cancelBtn = document.getElementById('dash-compass-cancel');
    const clearBtn = document.getElementById('dash-compass-clear');
    const pickBtn = document.getElementById('dash-compass-pick');
    if (!zone || !panel) return;

    if (!zone._compassWired) {
      zone.addEventListener('click', () => {
        panel.classList.remove('hidden');
        input.value = '';
        results.innerHTML = '';
        setTimeout(() => input.focus(), 50);
      });
      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.add('hidden');
      });
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        compassTarget = null;
        saveCompassTarget();
        renderCompassTarget();
        updateCompassArrow();
        panel.classList.add('hidden');
      });
      if (pickBtn) {
        pickBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          panel.classList.add('hidden');
          startMapPick();
        });
      }
      input.addEventListener('input', () => {
        clearTimeout(geocodeTimer);
        const q = input.value.trim();
        if (q.length < 3) { results.innerHTML = ''; return; }
        geocodeTimer = setTimeout(() => runGeocode(q, results, panel), 400);
      });
      panel.addEventListener('click', (e) => e.stopPropagation());
      zone._compassWired = true;
    }
  }

  function runGeocode(q, resultsDiv, panel) {
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=6`)
      .then(r => r.json())
      .then(data => {
        resultsDiv.innerHTML = '';
        if (!data.length) {
          resultsDiv.innerHTML = '<div class="dash-compass-results-item" style="color:var(--text-muted)">No results</div>';
          return;
        }
        data.forEach(item => {
          const d = document.createElement('div');
          d.className = 'dash-compass-results-item';
          d.textContent = item.display_name;
          d.addEventListener('click', () => {
            setCompassTarget({
              lat: parseFloat(item.lat),
              lng: parseFloat(item.lon),
              name: item.display_name.split(',').slice(0, 2).join(',').trim()
            });
            panel.classList.add('hidden');
          });
          resultsDiv.appendChild(d);
        });
      })
      .catch(() => {
        resultsDiv.innerHTML = '<div class="dash-compass-results-item" style="color:var(--text-muted)">Geocoding failed</div>';
      });
  }

  function setCompassTarget(t) {
    compassTarget = t;
    smoothedArrowRot = null; // re-prime EMA on new target
    saveCompassTarget();
    renderCompassTarget();
    updateCompassArrow();
  }

  function startMapPick() {
    // Close the dashboard overlay so the map is usable, then arm a one-shot click listener
    closeDashboard();
    const map = window.map;
    if (!map || typeof map.on !== 'function') {
      alert('Map not available.');
      return;
    }
    const banner = document.createElement('div');
    banner.id = 'compass-pick-banner';
    banner.textContent = 'Tap the map to set destination (Esc to cancel)';
    banner.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#00c853;color:#000;font-weight:600;padding:10px 16px;border-radius:8px;z-index:9999;box-shadow:0 4px 14px rgba(0,0,0,0.4);cursor:pointer;';
    document.body.appendChild(banner);

    const prevCursor = map.getContainer().style.cursor;
    map.getContainer().style.cursor = 'crosshair';

    const cleanup = (reopenDash) => {
      map.off('click', onMapClick);
      document.removeEventListener('keydown', onKey);
      banner.remove();
      map.getContainer().style.cursor = prevCursor;
      if (reopenDash) startDashboard(true);
    };
    const onMapClick = (e) => {
      const { lat, lng } = e.latlng;
      setCompassTarget({
        lat, lng,
        name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`
      });
      cleanup(true);
    };
    const onKey = (e) => { if (e.key === 'Escape') cleanup(true); };
    banner.addEventListener('click', () => cleanup(true));
    map.on('click', onMapClick);
    document.addEventListener('keydown', onKey);
  }


  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
  } else {
    initDashboard();
  }
})();
