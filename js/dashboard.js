// ===== GPS Dashboard - Speedometer, Instruments & Navigation =====
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

  // Temperature & weather
  let currentTemp = null;
  let lastTempFetch = 0;
  let currentWindSpeed = null;  // km/h
  let currentWindDir = null;    // degrees (meteorological, from)
  let currentWindGust = null;

  // Pressure trend
  let pressureHistory = []; // [{pressure, time}] ring buffer
  let pressureTrend = null; // slope in hPa/hr

  // Average speed
  let tripStartTime = null;

  // Compass target destination
  let compassTarget = null; // { lat, lng, name }
  let currentLat = null, currentLng = null;
  let currentHeading = null; // combined best heading (gps or compass)
  let geocodeTimer = null;
  let smoothedArrowRot = null; // EMA-smoothed arrow rotation in degrees

  // Lean angle
  let motionListener = null;
  let currentLean = 0;        // degrees, smoothed
  let peakLeanLeft = 0;
  let peakLeanRight = 0;
  let leanCalibration = 0;    // offset for non-vertical mounts

  // Radar
  let radarTimestamps = null;
  let radarTileCache = {};
  let lastRadarFetch = 0;
  let radarAnimFrame = null;

  // Elevation profile
  let lastElevUpdateDist = 0;

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
        currentWindSpeed = null;
        currentWindDir = null;
        currentWindGust = null;
        pressureHistory = [];
        pressureTrend = null;
        tripStartTime = null;
        currentLean = 0;
        peakLeanLeft = 0;
        peakLeanRight = 0;
        lastElevUpdateDist = 0;
        updateDisplay(0, null, null);
      }
      gpsStatus = 'waiting';
      updateGpsStatus('waiting');
      updateStatsStrip();
      initLeanArcs();

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

      // Start accelerometer for lean angle
      startLeanTracking();

      // Load saved target and wire up UI
      loadCompassTarget();
      setupCompassUI();
      renderCompassTarget();
      updateCompassArrow();

      // Watch for phone orientation flips (portrait ↔ landscape)
      screenOrientationListener = onScreenOrientationChange;
      window.addEventListener('orientationchange', screenOrientationListener);
      window.addEventListener('resize', screenOrientationListener);

      // Fetch radar data
      fetchRadarTimestamps();
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
      stopLeanTracking();
      stopRadar();

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

    // Fetch weather every 5 minutes (temp, wind, pressure)
    const now = Date.now();
    if (now - lastTempFetch > 5 * 60 * 1000) {
      lastTempFetch = now;
      fetchWeather(latitude, longitude);
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
    updateRadar();

    // Update elevation profile every 500m
    if (tripDistance - lastElevUpdateDist > 500) {
      lastElevUpdateDist = tripDistance;
      updateElevationProfile();
    }
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ===== Weather: temperature, wind, pressure =====

  function fetchWeather(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current_weather=true' +
      '&current=surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m';
    fetch(url)
      .then(r => r.json())
      .then(data => {
        if (data.current_weather) {
          currentTemp = Math.round(data.current_weather.temperature);
        }
        if (data.current) {
          // Wind
          currentWindSpeed = Math.round(data.current.wind_speed_10m);
          currentWindDir = data.current.wind_direction_10m;
          currentWindGust = data.current.wind_gusts_10m;
          updateWindDisplay();

          // Pressure
          const pressure = data.current.surface_pressure;
          if (pressure != null) {
            pressureHistory.push({ pressure, time: Date.now() });
            if (pressureHistory.length > 6) pressureHistory.shift(); // keep ~30 min window
            computePressureTrend();
          }
        }
        updateStatsStrip();
      })
      .catch(() => {});
  }

  function computePressureTrend() {
    if (pressureHistory.length < 2) { pressureTrend = null; return; }
    const first = pressureHistory[0];
    const last = pressureHistory[pressureHistory.length - 1];
    const hours = (last.time - first.time) / 3600000;
    if (hours < 0.05) { pressureTrend = null; return; } // need at least ~3 min
    pressureTrend = (last.pressure - first.pressure) / hours; // hPa/hr
    updatePressureDisplay();
  }

  function updatePressureDisplay() {
    const arrow = document.getElementById('dash-pressure-arrow');
    if (!arrow) return;

    if (pressureTrend === null) {
      arrow.style.opacity = '0.3';
      arrow.style.transform = 'rotate(0deg)';
      arrow.querySelector('polygon').setAttribute('fill', 'var(--text-muted)');
      return;
    }

    arrow.style.opacity = '1';
    let rotation, color;
    if (pressureTrend > 1) {
      rotation = 0; color = '#00c853';          // rising fast ↑
    } else if (pressureTrend > 0.3) {
      rotation = 45; color = '#00c853';          // rising ↗
    } else if (pressureTrend > -0.3) {
      rotation = 90; color = 'var(--text-secondary)';  // stable →
    } else if (pressureTrend > -1) {
      rotation = 135; color = '#ffab40';         // falling ↘
    } else {
      rotation = 180; color = '#ff5252';         // falling fast ↓
    }
    arrow.style.transform = `rotate(${rotation}deg)`;
    arrow.querySelector('polygon').setAttribute('fill', color);
  }

  function updateWindDisplay() {
    const valEl = document.getElementById('dash-wind-value');
    const arrowEl = document.getElementById('dash-wind-arrow');
    if (valEl) valEl.textContent = currentWindSpeed !== null ? currentWindSpeed : '--';

    if (arrowEl && currentWindDir !== null && currentHeading !== null) {
      // Relative wind direction: rotate so "up" means headwind
      // Wind direction is where wind comes FROM (meteorological convention)
      // Relative = windDir - heading. Arrow points where wind comes FROM relative to rider.
      const relativeDir = ((currentWindDir - currentHeading) + 360) % 360;
      arrowEl.style.transform = `rotate(${relativeDir}deg)`;

      // Color by crosswind component
      const crossAngle = Math.abs(Math.sin(relativeDir * Math.PI / 180));
      const crossSpeed = (currentWindSpeed || 0) * crossAngle;
      let color;
      if (crossSpeed > 40) color = '#ff5252';       // danger
      else if (crossSpeed > 25) color = '#ffab40';   // warning
      else if (crossSpeed > 15) color = 'var(--text-secondary)';
      else color = 'var(--text-muted)';
      arrowEl.querySelector('polygon').setAttribute('fill', color);
    } else if (arrowEl) {
      arrowEl.style.transform = 'rotate(0deg)';
      arrowEl.querySelector('polygon').setAttribute('fill', 'var(--text-muted)');
    }
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
        updateWindDisplay();
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

  // ===== Lean Angle (DeviceMotion accelerometer) =====

  function startLeanTracking() {
    if (!window.DeviceMotionEvent) return;

    // iOS 13+ requires permission
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      DeviceMotionEvent.requestPermission()
        .then(state => { if (state === 'granted') attachMotionListener(); })
        .catch(() => {});
    } else {
      attachMotionListener();
    }
  }

  function attachMotionListener() {
    motionListener = onDeviceMotion;
    window.addEventListener('devicemotion', motionListener);
  }

  function stopLeanTracking() {
    if (motionListener) {
      window.removeEventListener('devicemotion', motionListener);
      motionListener = null;
    }
  }

  const LEAN_EMA_ALPHA = 0.15; // smoothing factor — lower = smoother, more latency

  function onDeviceMotion(event) {
    const accel = event.accelerationIncludingGravity;
    if (!accel || accel.x === null || accel.z === null) return;

    // Raw lean = phone roll angle
    // atan2(lateral, vertical) gives tilt from upright
    let rawLean = Math.atan2(accel.x, Math.abs(accel.z)) * (180 / Math.PI);

    // Adjust for screen orientation (landscape left vs right)
    const orient = (screen.orientation || {}).angle || window.orientation || 0;
    if (orient === 90) rawLean = -rawLean;
    // orient === -90 or 270: lean is already correct sign
    // orient === 0 (portrait): lean works as-is for most mounts

    // Apply calibration offset
    rawLean -= leanCalibration;

    // EMA smoothing
    currentLean = currentLean + LEAN_EMA_ALPHA * (rawLean - currentLean);

    // Track peaks
    if (currentLean < -1 && Math.abs(currentLean) > peakLeanLeft) peakLeanLeft = Math.abs(currentLean);
    if (currentLean > 1 && currentLean > peakLeanRight) peakLeanRight = currentLean;

    updateLeanDisplay();
  }

  function initLeanArcs() {
    // Pre-compute background arc paths
    const svg = document.getElementById('dash-lean-arcs');
    if (!svg) return;

    const cx = 100, cy = 100, r = 92;
    const MAX_ANGLE = 45;

    // Left arc: from 270° (bottom) sweeping counter-clockwise to (270 - MAX_ANGLE)
    const leftBg = document.getElementById('dash-lean-left-bg');
    const rightBg = document.getElementById('dash-lean-right-bg');

    if (leftBg) leftBg.setAttribute('d', describeArc(cx, cy, r, 270 - MAX_ANGLE, 270));
    if (rightBg) rightBg.setAttribute('d', describeArc(cx, cy, r, 270, 270 + MAX_ANGLE));

    // Clear active arcs
    const leftArc = document.getElementById('dash-lean-left');
    const rightArc = document.getElementById('dash-lean-right');
    if (leftArc) leftArc.setAttribute('d', '');
    if (rightArc) rightArc.setAttribute('d', '');
  }

  function updateLeanDisplay() {
    const MAX_ANGLE = 45;
    const absLean = Math.min(Math.abs(currentLean), MAX_ANGLE);
    const leanDir = currentLean < 0 ? 'L' : 'R';
    const cx = 100, cy = 100, r = 92;

    // Update readout text
    const readout = document.getElementById('dash-lean-readout');
    if (readout) {
      if (absLean > 1) {
        readout.textContent = `${Math.round(absLean)}° ${leanDir}`;
      } else {
        readout.textContent = '';
      }
    }

    // Update active arc
    const leftArc = document.getElementById('dash-lean-left');
    const rightArc = document.getElementById('dash-lean-right');

    // Color based on lean angle
    const color = absLean > 35 ? '#ff5252' : absLean > 20 ? '#ffab40' : '#00c853';

    if (currentLean < -1 && leftArc) {
      leftArc.setAttribute('d', describeArc(cx, cy, r, 270 - absLean, 270));
      leftArc.setAttribute('stroke', color);
      if (rightArc) rightArc.setAttribute('d', '');
    } else if (currentLean > 1 && rightArc) {
      rightArc.setAttribute('d', describeArc(cx, cy, r, 270, 270 + absLean));
      rightArc.setAttribute('stroke', color);
      if (leftArc) leftArc.setAttribute('d', '');
    } else {
      if (leftArc) leftArc.setAttribute('d', '');
      if (rightArc) rightArc.setAttribute('d', '');
    }

    // Peak lean tick marks
    updatePeakTick('dash-lean-peak-left', peakLeanLeft, cx, cy, r, true);
    updatePeakTick('dash-lean-peak-right', peakLeanRight, cx, cy, r, false);
  }

  function updatePeakTick(id, peakAngle, cx, cy, r, isLeft) {
    const el = document.getElementById(id);
    if (!el || peakAngle < 2) return;
    const angle = Math.min(peakAngle, 45);
    const deg = isLeft ? (270 - angle) : (270 + angle);
    const rad = deg * Math.PI / 180;
    const innerR = r - 6;
    const outerR = r + 6;
    el.setAttribute('x1', cx + innerR * Math.cos(rad));
    el.setAttribute('y1', cy + innerR * Math.sin(rad));
    el.setAttribute('x2', cx + outerR * Math.cos(rad));
    el.setAttribute('y2', cy + outerR * Math.sin(rad));
  }

  function describeArc(cx, cy, r, startAngle, endAngle) {
    const startRad = startAngle * Math.PI / 180;
    const endRad = endAngle * Math.PI / 180;
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    const largeArc = (endAngle - startAngle) > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
  }

  // ===== Weather Radar Minimap (RainViewer API) =====

  function fetchRadarTimestamps() {
    fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then(r => r.json())
      .then(data => {
        if (data.radar && data.radar.past) {
          radarTimestamps = data.radar.past;
          lastRadarFetch = Date.now();
          updateRadar();
        }
      })
      .catch(() => {});
  }

  function updateRadar() {
    if (!radarTimestamps || !currentLat || !currentLng) return;

    // Refresh radar timestamps every 10 minutes
    if (Date.now() - lastRadarFetch > 10 * 60 * 1000) {
      fetchRadarTimestamps();
      return;
    }

    const canvas = document.getElementById('dash-radar-canvas');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const size = canvas.clientWidth;
    if (size === 0) return;
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2, cy = size / 2;
    const radius = size / 2;

    // Clip to circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
    ctx.clip();

    // Dark background
    ctx.fillStyle = 'rgba(15,22,30,0.8)';
    ctx.fillRect(0, 0, size, size);

    // Draw range ring
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.7, 0, Math.PI * 2);
    ctx.stroke();

    // Get latest radar timestamp
    const latest = radarTimestamps[radarTimestamps.length - 1];
    if (!latest) { ctx.restore(); drawRadarOverlay(ctx, cx, cy, radius, size); return; }

    // Calculate tile coordinates for the rider's position at zoom level 7
    // This gives a ~150km view which we'll crop to ~20km
    const zoom = 9; // Higher zoom for better detail at 20km radius
    const tileX = Math.floor((currentLng + 180) / 360 * Math.pow(2, zoom));
    const latRad = currentLat * Math.PI / 180;
    const tileY = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, zoom));

    const tileKey = `${latest.path}/${zoom}/${tileX}/${tileY}`;

    if (radarTileCache[tileKey]) {
      drawRadarTile(ctx, radarTileCache[tileKey], cx, cy, radius, size, zoom, tileX, tileY);
    } else {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        radarTileCache[tileKey] = img;
        // Evict old cache entries
        const keys = Object.keys(radarTileCache);
        if (keys.length > 20) delete radarTileCache[keys[0]];
        updateRadar(); // redraw
      };
      img.onerror = () => {};
      img.src = `https://tilecache.rainviewer.com${latest.path}/256/${zoom}/${tileX}/${tileY}/4/1_1.png`;
    }

    ctx.restore();
    drawRadarOverlay(ctx, cx, cy, radius, size);
  }

  function drawRadarTile(ctx, img, cx, cy, radius, size, zoom, tileX, tileY) {
    // Calculate where the rider's position falls within the tile (0-1)
    const n = Math.pow(2, zoom);
    const tileLeftLng = tileX / n * 360 - 180;
    const tileRightLng = (tileX + 1) / n * 360 - 180;
    const tileTopLatRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / n)));
    const tileBotLatRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (tileY + 1) / n)));
    const tileTopLat = tileTopLatRad * 180 / Math.PI;
    const tileBotLat = tileBotLatRad * 180 / Math.PI;

    // Rider position as fraction within tile
    const rx = (currentLng - tileLeftLng) / (tileRightLng - tileLeftLng);
    const ry = (currentLat - tileTopLat) / (tileBotLat - tileTopLat);

    // We want the tile centered on the rider, scaled so 20km ≈ radius
    // At this latitude, 1 degree ≈ 111km. Tile width in km:
    const tileWidthKm = (tileRightLng - tileLeftLng) * 111 * Math.cos(currentLat * Math.PI / 180);
    const rangeKm = 20;
    const scale = (size / (rangeKm * 2)) * tileWidthKm / 256;

    // Rotate for heading-up
    const headingRad = currentHeading ? -currentHeading * Math.PI / 180 : 0;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(headingRad);
    ctx.translate(-rx * 256 * scale, -ry * 256 * scale);
    ctx.drawImage(img, 0, 0, 256 * scale, 256 * scale);
    ctx.restore();
  }

  function drawRadarOverlay(ctx, cx, cy, radius, size) {
    // Rider dot at center
    ctx.fillStyle = '#00c853';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();

    // Heading indicator (small line pointing up from center)
    ctx.strokeStyle = 'rgba(0,200,83,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 4);
    ctx.lineTo(cx, cy - radius * 0.3);
    ctx.stroke();

    // North indicator
    if (currentHeading !== null) {
      const northRad = -currentHeading * Math.PI / 180;
      const nx = cx + (radius - 8) * Math.sin(northRad);
      const ny = cy - (radius - 8) * Math.cos(northRad);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '8px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('N', nx, ny);
    }
  }

  function stopRadar() {
    if (radarAnimFrame) {
      cancelAnimationFrame(radarAnimFrame);
      radarAnimFrame = null;
    }
  }

  // ===== Elevation Profile Sparkline =====

  function updateElevationProfile() {
    // Check if RoutePlanner has elevation data
    if (typeof RoutePlanner === 'undefined' || !RoutePlanner.lastElevationData) {
      hideElevationStrip();
      return;
    }

    const elData = RoutePlanner.lastElevationData;
    if (!elData || !elData.points || !elData.elevations || !currentLat || !currentLng) {
      hideElevationStrip();
      return;
    }

    // Find nearest point on route to current position
    let minDist = Infinity, nearestIdx = 0;
    for (let i = 0; i < elData.points.length; i++) {
      const d = haversine(currentLat, currentLng, elData.points[i].lat, elData.points[i].lng);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }

    // If rider is >2km from route, hide profile
    if (minDist > 2000) {
      hideElevationStrip();
      return;
    }

    // Extract forward-looking 20km slice
    const startDist = elData.distances[nearestIdx];
    const endDist = startDist + 20; // 20km ahead
    const sliceIdx = [];
    for (let i = nearestIdx; i < elData.points.length; i++) {
      if (elData.distances[i] - startDist > 20) break;
      sliceIdx.push(i);
    }

    if (sliceIdx.length < 3) {
      hideElevationStrip();
      return;
    }

    // Show the strip
    const strip = document.getElementById('dash-elevation-strip');
    if (strip) strip.classList.remove('hidden');

    // Calculate gain remaining
    let gainRemaining = 0;
    let maxElev = -Infinity;
    for (let i = 0; i < sliceIdx.length - 1; i++) {
      const diff = elData.elevations[sliceIdx[i + 1]] - elData.elevations[sliceIdx[i]];
      if (diff > 0) gainRemaining += diff;
      if (elData.elevations[sliceIdx[i]] > maxElev) maxElev = elData.elevations[sliceIdx[i]];
    }
    if (elData.elevations[sliceIdx[sliceIdx.length - 1]] > maxElev) {
      maxElev = elData.elevations[sliceIdx[sliceIdx.length - 1]];
    }

    // Update stats
    const statsEl = document.getElementById('dash-elevation-stats');
    if (statsEl) {
      statsEl.innerHTML = `<span class="elev-gain">\u2191${Math.round(gainRemaining)}m</span>` +
        `<span class="elev-max">${Math.round(maxElev)}m</span>`;
    }

    // Draw sparkline
    drawElevationSparkline(elData, sliceIdx, startDist);
  }

  function drawElevationSparkline(elData, sliceIdx, startDist) {
    const canvas = document.getElementById('dash-elevation-canvas');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const elevs = sliceIdx.map(i => elData.elevations[i]);
    const dists = sliceIdx.map(i => elData.distances[i] - startDist);
    const minE = Math.min(...elevs) - 10;
    const maxE = Math.max(...elevs) + 10;
    const rangeE = maxE - minE || 1;
    const maxDist = dists[dists.length - 1] || 1;

    const pad = { top: 2, bottom: 4, left: 2, right: 2 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const toX = d => pad.left + (d / maxDist) * plotW;
    const toY = e => pad.top + plotH - ((e - minE) / rangeE) * plotH;

    // Fill area
    ctx.beginPath();
    ctx.moveTo(toX(dists[0]), h);
    ctx.lineTo(toX(dists[0]), toY(elevs[0]));
    for (let i = 1; i < elevs.length; i++) {
      ctx.lineTo(toX(dists[i]), toY(elevs[i]));
    }
    ctx.lineTo(toX(dists[dists.length - 1]), h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,200,83,0.12)';
    ctx.fill();

    // Stroke line with grade-based coloring
    for (let i = 1; i < elevs.length; i++) {
      const grade = Math.abs(elevs[i] - elevs[i - 1]) / ((dists[i] - dists[i - 1]) * 1000) * 100;
      ctx.strokeStyle = grade > 8 ? '#ff5252' : grade > 4 ? '#ffab40' : '#00c853';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(toX(dists[i - 1]), toY(elevs[i - 1]));
      ctx.lineTo(toX(dists[i]), toY(elevs[i]));
      ctx.stroke();
    }

    // Current position dot
    ctx.fillStyle = '#00c853';
    ctx.beginPath();
    ctx.arc(toX(0), toY(elevs[0]), 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function hideElevationStrip() {
    const strip = document.getElementById('dash-elevation-strip');
    if (strip) strip.classList.add('hidden');
  }

  // ===== Compass Arrow to Destination =====

  function bearingTo(lat1, lon1, lat2, lon2) {
    const toRad = x => x * Math.PI / 180;
    const toDeg = x => x * 180 / Math.PI;
    const p1 = toRad(lat1), p2 = toRad(lat2);
    const dl = toRad(lon2 - lon1);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
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
    const alpha = 2 / (5 + 1); // ~0.333
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
      // Re-init lean arcs for new dimensions
      initLeanArcs();
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
