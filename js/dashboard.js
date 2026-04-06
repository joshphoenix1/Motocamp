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
  let lastGpsHeadingTime = 0;
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

  // Lean peak reset
  let peakResetInterval = null;

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
        leanCalibSamples = [];
        leanCalibration = 0;
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

      // Reset peak lean every 60 seconds
      if (peakResetInterval) clearInterval(peakResetInterval);
      peakResetInterval = setInterval(() => {
        peakLeanLeft = 0;
        peakLeanRight = 0;
        // Clear peak tick marks
        const pl = document.getElementById('dash-lean-peak-left');
        const pr = document.getElementById('dash-lean-peak-right');
        if (pl) { pl.setAttribute('x1', 0); pl.setAttribute('y1', 0); pl.setAttribute('x2', 0); pl.setAttribute('y2', 0); }
        if (pr) { pr.setAttribute('x1', 0); pr.setAttribute('y1', 0); pr.setAttribute('x2', 0); pr.setAttribute('y2', 0); }
        const ml = document.getElementById('dash-max-lean');
        if (ml) ml.textContent = '0';
      }, 90000);

      // Load saved target and wire up UI
      loadCompassTarget();
      setupCompassUI();
      renderCompassTarget();
      updateCompassArrow();

      // Watch for phone orientation flips (portrait ↔ landscape)
      screenOrientationListener = onScreenOrientationChange;
      window.addEventListener('orientationchange', screenOrientationListener);
      window.addEventListener('resize', screenOrientationListener);

      // Fetch precipitation data for radar
      fetchPrecipGrid();
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
      if (peakResetInterval) { clearInterval(peakResetInterval); peakResetInterval = null; }
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
      lastGpsHeadingTime = Date.now();
    }

    // When moving: use GPS heading (accurate).
    // When stopped: hold last GPS heading, only blend toward compass slowly.
    if (speedKmh > 5 && gpsHeading !== null) {
      currentHeading = gpsHeading;
    } else if (gpsHeading !== null) {
      // Stopped — hold GPS heading for 10s, then blend toward compass
      const staleSec = (Date.now() - lastGpsHeadingTime) / 1000;
      if (staleSec < 10 || compassHeading === null) {
        currentHeading = gpsHeading; // hold GPS heading
      } else {
        // Slow blend: 0 at 10s, full compass at ~30s
        const blend = Math.min(1, (staleSec - 10) / 20);
        const delta = ((compassHeading - gpsHeading + 540) % 360) - 180;
        currentHeading = (gpsHeading + delta * blend + 360) % 360;
      }
    } else {
      currentHeading = compassHeading;
    }
    const hdg = currentHeading !== null ? Math.round(currentHeading) : null;
    updateDisplay(speedKmh, alt, hdg);
    updateStatsStrip();
    updateCompassArrow();
    updateRadar();

    // Update elevation profile on first fix and every 500m
    if (lastElevUpdateDist === 0 || tripDistance - lastElevUpdateDist > 500) {
      lastElevUpdateDist = Math.max(tripDistance, 1); // avoid re-triggering at 0
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
      // When stationary, blend heading toward compass gradually
      // (the blend logic lives in onPosition — here we just trigger an update)
      if (lastGpsSpeed <= 5) {
        // Recompute blended heading
        if (gpsHeading !== null) {
          const staleSec = (Date.now() - lastGpsHeadingTime) / 1000;
          if (staleSec < 10) {
            currentHeading = gpsHeading;
          } else {
            const blend = Math.min(1, (staleSec - 10) / 20);
            const delta = ((compassHeading - gpsHeading + 540) % 360) - 180;
            currentHeading = (gpsHeading + delta * blend + 360) % 360;
          }
        } else {
          currentHeading = heading;
        }
        const hdg = Math.round(currentHeading);
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

  const LEAN_EMA_ALPHA = 0.18; // smoothing — higher = more responsive, lower = smoother
  let leanCalibSamples = [];
  const LEAN_CALIB_COUNT = 30; // auto-calibrate from first N samples (~0.5s at 60Hz)
  const LEAN_CALIB_MIN_SPEED = 15; // km/h — only calibrate when riding (bike is upright)
  const LEAN_RECALIB_RATE = 0.002; // how fast continuous recalibration nudges the offset

  function onDeviceMotion(event) {
    const accel = event.accelerationIncludingGravity;
    if (!accel || accel.x === null || accel.y === null || accel.z === null) return;

    // Determine which physical axis is "lateral" (left-right tilt) based on
    // screen orientation. The accelerometer always reports in device-physical
    // coordinates, so we must pick the right axis for each rotation.
    const orient = (screen.orientation || {}).angle || window.orientation || 0;
    let lateral;
    switch (orient) {
      case 90:   lateral =  accel.y; break;  // landscape left (home button right)
      case -90:
      case 270:  lateral = -accel.y; break;  // landscape right (home button left)
      default:   lateral =  accel.x; break;  // portrait
    }

    // True roll angle independent of pitch (forward-leaning mount safe).
    // atan2(lateral, sqrt(other² + z²)) gives roll regardless of pitch angle.
    const other = (orient === 90 || orient === -90 || orient === 270) ? accel.x : accel.y;
    const rawLean = Math.atan2(lateral, Math.sqrt(other * other + accel.z * accel.z)) * (180 / Math.PI);

    // Auto-calibration: collect samples only while riding above min speed,
    // so the bike is upright and we capture the true mount offset — not a
    // kickstand angle or a hand-held tilt from before the ride started.
    if (leanCalibSamples.length < LEAN_CALIB_COUNT) {
      if (lastGpsSpeed >= LEAN_CALIB_MIN_SPEED) {
        leanCalibSamples.push(rawLean);
        if (leanCalibSamples.length === LEAN_CALIB_COUNT) {
          leanCalibration = leanCalibSamples.reduce((a, b) => a + b, 0) / LEAN_CALIB_COUNT;
          currentLean = 0;
        }
      }
      return; // don't display until calibrated
    }

    // Continuous recalibration: when cruising straight at speed, slowly nudge
    // the calibration offset toward the current reading. This corrects for the
    // phone shifting in the mount mid-ride. Only applies when the calibrated
    // value is small (< 5°, i.e. roughly upright) and speed is high enough
    // that the bike genuinely is upright — not mid-corner.
    const calibrated = rawLean - leanCalibration;
    if (lastGpsSpeed >= LEAN_CALIB_MIN_SPEED && Math.abs(calibrated) < 5) {
      leanCalibration += calibrated * LEAN_RECALIB_RATE;
    }

    // Double EMA smoothing (two passes for less jitter, slightly more lag)
    currentLean = currentLean + LEAN_EMA_ALPHA * (calibrated - currentLean);

    // Deadband: suppress display jitter below 3°
    const displayLean = Math.abs(currentLean) < 3 ? 0 : currentLean;

    // Track peaks (use raw smoothed, not deadbanded)
    if (currentLean < -1 && Math.abs(currentLean) > peakLeanLeft) peakLeanLeft = Math.abs(currentLean);
    if (currentLean > 1 && currentLean > peakLeanRight) peakLeanRight = currentLean;

    updateLeanDisplay(displayLean);
  }

  function initLeanArcs() {
    const svg = document.getElementById('dash-lean-arcs');
    if (!svg) return;

    const cx = 100, cy = 100, r = 92;
    const MAX_ANGLE = 45;

    // Background arc paths
    const leftBg = document.getElementById('dash-lean-left-bg');
    const rightBg = document.getElementById('dash-lean-right-bg');
    if (leftBg) leftBg.setAttribute('d', describeArc(cx, cy, r, 270 - MAX_ANGLE, 270));
    if (rightBg) rightBg.setAttribute('d', describeArc(cx, cy, r, 270, 270 + MAX_ANGLE));

    // Clear active arcs
    const leftArc = document.getElementById('dash-lean-left');
    const rightArc = document.getElementById('dash-lean-right');
    if (leftArc) leftArc.setAttribute('d', '');
    if (rightArc) rightArc.setAttribute('d', '');

    // Remove old tick marks (in case of re-init on orientation change)
    svg.querySelectorAll('.lean-tick').forEach(el => el.remove());

    // Add degree tick marks at 10, 20, 30, 40 on both sides
    const ticks = [10, 20, 30, 40];
    const innerR = r - 4;
    const outerR = r + 4;
    const labelR = r + 14;

    ticks.forEach(angle => {
      // Both left and right
      [270 - angle, 270 + angle].forEach((deg, side) => {
        const rad = deg * Math.PI / 180;

        // Tick line
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('class', 'lean-tick');
        line.setAttribute('x1', cx + innerR * Math.cos(rad));
        line.setAttribute('y1', cy + innerR * Math.sin(rad));
        line.setAttribute('x2', cx + outerR * Math.cos(rad));
        line.setAttribute('y2', cy + outerR * Math.sin(rad));
        line.setAttribute('stroke', 'rgba(255,255,255,0.4)');
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('stroke-linecap', 'round');
        svg.appendChild(line);

        // Label
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'lean-tick');
        text.setAttribute('x', cx + labelR * Math.cos(rad));
        text.setAttribute('y', cy + labelR * Math.sin(rad));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'central');
        text.setAttribute('fill', 'rgba(255,255,255,0.45)');
        text.setAttribute('font-size', '8');
        text.setAttribute('font-family', 'Inter, sans-serif');
        text.textContent = angle + '°';
        svg.appendChild(text);
      });
    });
  }

  function updateLeanDisplay(lean) {
    if (lean === undefined) lean = currentLean;
    const MAX_ANGLE = 45;
    const absLean = Math.min(Math.abs(lean), MAX_ANGLE);
    const leanDir = lean < 0 ? 'L' : 'R';
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

    if (lean < -1 && leftArc) {
      leftArc.setAttribute('d', describeArc(cx, cy, r, 270 - absLean, 270));
      leftArc.setAttribute('stroke', color);
      if (rightArc) rightArc.setAttribute('d', '');
    } else if (lean > 1 && rightArc) {
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

    // Max lean number
    const maxLeanEl = document.getElementById('dash-max-lean');
    if (maxLeanEl) {
      maxLeanEl.textContent = Math.round(Math.max(peakLeanLeft, peakLeanRight));
    }
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

  // ===== Weather Radar Minimap (Open-Meteo precipitation grid) =====
  // RainViewer has almost no radar coverage in NZ. Instead we use Open-Meteo's
  // precipitation forecast on a grid around the rider. This gives reliable
  // global coverage including NZ, and shows forecast rain (next 3h), not just
  // current radar returns.

  let precipGrid = null;     // { lats[], lons[], precip[][], time }
  let precipFetchInFlight = false;
  const PRECIP_GRID_SIZE = 7; // 7x7 = 49 points
  const PRECIP_SPACING_DEG = 0.22; // ~24km spacing → ~150km total coverage
  const RADAR_RANGE_KM = 60;

  function fetchPrecipGrid() {
    if (!currentLat || !currentLng || precipFetchInFlight) return;
    precipFetchInFlight = true;

    const lat = currentLat;
    const lng = currentLng;
    const lats = [], lons = [];
    const half = Math.floor(PRECIP_GRID_SIZE / 2);
    // Adjust longitude spacing for latitude (degrees get narrower toward poles)
    const lngSpacing = PRECIP_SPACING_DEG / Math.cos(lat * Math.PI / 180);
    for (let i = -half; i <= half; i++) {
      for (let j = -half; j <= half; j++) {
        lats.push((lat + i * PRECIP_SPACING_DEG).toFixed(2));
        lons.push((lng + j * lngSpacing).toFixed(2));
      }
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(',')}&longitude=${lons.join(',')}` +
      '&hourly=precipitation&forecast_hours=3&forecast_days=1';

    console.log(`Radar: fetching precip grid at ${lat.toFixed(3)}, ${lng.toFixed(3)}`);

    fetch(url)
      .then(r => r.json())
      .then(data => {
        const points = Array.isArray(data) ? data : [data];
        if (points.length !== PRECIP_GRID_SIZE * PRECIP_GRID_SIZE) {
          console.warn('Radar: unexpected response count', points.length);
        }
        const grid = [];
        let maxPrecip = 0;
        for (let i = 0; i < PRECIP_GRID_SIZE; i++) {
          grid[i] = [];
          for (let j = 0; j < PRECIP_GRID_SIZE; j++) {
            const idx = i * PRECIP_GRID_SIZE + j;
            const hourly = points[idx]?.hourly?.precipitation || [0, 0, 0];
            const val = Math.max(...hourly);
            grid[i][j] = val;
            if (val > maxPrecip) maxPrecip = val;
          }
        }
        precipGrid = {
          lats: lats.map(Number),
          lons: lons.map(Number),
          grid: grid,
          centerLat: lat,
          centerLng: lng,
          time: Date.now()
        };
        lastRadarFetch = Date.now();
        precipFetchInFlight = false;
        console.log(`Radar: grid loaded, max precip ${maxPrecip.toFixed(1)}mm`);
        drawRadar();
      })
      .catch(err => {
        precipFetchInFlight = false;
        console.warn('Radar fetch failed:', err);
      });
  }

  function updateRadar() {
    if (!currentLat || !currentLng) return;

    // Fetch new data every 10 minutes
    if (!precipGrid || Date.now() - lastRadarFetch > 10 * 60 * 1000) {
      fetchPrecipGrid();
    }
    drawRadar();
  }

  function drawRadar() {
    const canvas = document.getElementById('dash-radar-canvas');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const size = canvas.clientWidth;
    if (size === 0) return;
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const cx = size / 2, cy = size / 2;
    const radius = size / 2;

    // Clip to circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
    ctx.clip();

    // Dark background
    ctx.fillStyle = '#0f161e';
    ctx.fillRect(0, 0, size, size);

    // Crosshair lines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, size);
    ctx.moveTo(0, cy); ctx.lineTo(size, cy);
    ctx.stroke();

    // Range rings (15km and ~27km)
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw precipitation field if we have data
    if (precipGrid && precipGrid.grid) {
      drawPrecipField(ctx, cx, cy, radius, size);
    }

    ctx.restore();
    drawRadarOverlay(ctx, cx, cy, radius, size);
  }

  // Ventusky-style color ramp: precipitation mm → [r, g, b, a]
  // Smooth gradient from transparent → blue → cyan → green → yellow → orange → red → magenta
  const PRECIP_COLORS = [
    { val: 0,    r: 0,   g: 0,   b: 0,   a: 0   },
    { val: 0.02, r: 20,  g: 50,  b: 140, a: 0.5 },  // faint blue
    { val: 0.1,  r: 30,  g: 90,  b: 200, a: 0.65 }, // dark blue
    { val: 0.3,  r: 40,  g: 140, b: 230, a: 0.75 }, // blue
    { val: 0.5,  r: 30,  g: 190, b: 230, a: 0.8 },  // cyan
    { val: 1.0,  r: 40,  g: 210, b: 110, a: 0.85 }, // green
    { val: 2.0,  r: 160, g: 230, b: 40,  a: 0.85 }, // lime
    { val: 4.0,  r: 245, g: 225, b: 30,  a: 0.9 },  // yellow
    { val: 7.0,  r: 255, g: 165, b: 20,  a: 0.9 },  // orange
    { val: 12,   r: 245, g: 50,  b: 30,  a: 0.95 }, // red
    { val: 20,   r: 210, g: 30,  b: 170, a: 1.0 },  // magenta
    { val: 40,   r: 170, g: 20,  b: 210, a: 1.0 },  // purple
  ];

  function precipToColor(val) {
    if (val <= 0) return [0, 0, 0, 0];
    const stops = PRECIP_COLORS;
    // Find bracketing stops
    for (let i = 1; i < stops.length; i++) {
      if (val <= stops[i].val) {
        const lo = stops[i - 1], hi = stops[i];
        const t = (val - lo.val) / (hi.val - lo.val);
        return [
          lo.r + t * (hi.r - lo.r),
          lo.g + t * (hi.g - lo.g),
          lo.b + t * (hi.b - lo.b),
          lo.a + t * (hi.a - lo.a)
        ];
      }
    }
    const last = stops[stops.length - 1];
    return [last.r, last.g, last.b, last.a];
  }

  // Bilinear interpolation of precipitation at a point in grid-space
  function interpolatePrecip(gy, gx) {
    const grid = precipGrid.grid;
    const gi = Math.floor(gy), gj = Math.floor(gx);
    if (gi < 0 || gi >= PRECIP_GRID_SIZE - 1 || gj < 0 || gj >= PRECIP_GRID_SIZE - 1) return 0;
    const ty = gy - gi, tx = gx - gj;
    return (
      grid[gi][gj]       * (1 - ty) * (1 - tx) +
      grid[gi][gj + 1]   * (1 - ty) * tx +
      grid[gi + 1][gj]   * ty       * (1 - tx) +
      grid[gi + 1][gj + 1] * ty     * tx
    );
  }

  function drawPrecipField(ctx, cx, cy, radius, size) {
    // Render to a small offscreen canvas, then scale up for smooth look
    const RES = 80; // 80x80 interpolated field
    const off = document.createElement('canvas');
    off.width = RES;
    off.height = RES;
    const octx = off.getContext('2d');
    const imgData = octx.createImageData(RES, RES);
    const data = imgData.data;

    const kmPerDegLat = 111.32;
    const kmPerDegLng = 111.32 * Math.cos(currentLat * Math.PI / 180);

    // Grid point spacing in km
    const gridStepLatKm = PRECIP_SPACING_DEG * kmPerDegLat;
    const lngSpacing = PRECIP_SPACING_DEG / Math.cos(precipGrid.centerLat * Math.PI / 180);
    const gridStepLngKm = lngSpacing * kmPerDegLng;

    // Center of grid (index 3,3 for a 7x7 grid)
    const half = Math.floor(PRECIP_GRID_SIZE / 2);

    // Heading rotation
    const headingRad = currentHeading ? currentHeading * Math.PI / 180 : 0;
    const cosH = Math.cos(headingRad), sinH = Math.sin(headingRad);

    // Offset from grid center to current rider position (in grid-index units)
    const riderOffsetLat = (currentLat - precipGrid.centerLat) / PRECIP_SPACING_DEG;
    const riderOffsetLng = (currentLng - precipGrid.centerLng) / lngSpacing;

    for (let py = 0; py < RES; py++) {
      for (let px = 0; px < RES; px++) {
        // Canvas pixel to km from rider (center of offscreen = rider position)
        const kmX = ((px / RES) * 2 - 1) * RADAR_RANGE_KM;
        const kmY = ((py / RES) * 2 - 1) * RADAR_RANGE_KM;

        // Skip outside circle
        if (kmX * kmX + kmY * kmY > RADAR_RANGE_KM * RADAR_RANGE_KM) {
          const idx = (py * RES + px) * 4;
          data[idx] = data[idx + 1] = data[idx + 2] = data[idx + 3] = 0;
          continue;
        }

        // Rotate from heading-up screen space to north-up world space
        const worldKmX = kmX * cosH - kmY * sinH;
        const worldKmY = kmX * sinH + kmY * cosH;

        // World km to grid index (grid center is at index half,half)
        const gx = half + riderOffsetLng + worldKmX / gridStepLngKm;
        const gy = half + riderOffsetLat - worldKmY / gridStepLatKm; // lat increases north, grid row increases south

        const val = interpolatePrecip(gy, gx);
        const [r, g, b, a] = precipToColor(val);

        const idx = (py * RES + px) * 4;
        data[idx]     = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = a * 255;
      }
    }

    octx.putImageData(imgData, 0, 0);

    // Draw scaled-up offscreen canvas onto main canvas with smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, cx - radius, cy - radius, radius * 2, radius * 2);
  }

  function drawRadarOverlay(ctx, cx, cy, radius, size) {
    // Rider dot at center
    ctx.fillStyle = '#00c853';
    ctx.shadowColor = 'rgba(0,200,83,0.6)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Heading indicator (small line pointing up from center)
    ctx.strokeStyle = 'rgba(0,200,83,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx, cy - radius * 0.35);
    ctx.stroke();

    // North indicator (rotated to correct position in heading-up mode)
    if (currentHeading !== null) {
      const northRad = (-currentHeading) * Math.PI / 180;
      const nr = radius - 8;
      const nx = cx + nr * Math.sin(northRad);
      const ny = cy - nr * Math.cos(northRad);
      ctx.fillStyle = 'rgba(255,80,80,0.7)';
      ctx.font = 'bold 8px Inter, sans-serif';
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
