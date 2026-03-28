// ===== GPS Dashboard - Speedometer, Altitude & G-Force =====
(function() {
  'use strict';

  let watchId = null;
  let maxSpeed = 0;
  let gForceX = 0, gForceY = 0;
  let maxGForce = 0;
  let motionListener = null;
  let orientationListener = null;
  let wakeLock = null;
  let gpsStatus = 'waiting'; // waiting, active, error
  let lastGpsTime = 0;
  let compassHeading = null; // device compass fallback
  let gpsHeading = null;
  let lastGpsSpeed = 0;
  let gpsCheckInterval = null;

  // Altitude history: store {time, alt} for last 30 minutes
  let altitudeHistory = [];
  const ALT_HISTORY_MS = 30 * 60 * 1000; // 30 minutes

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

  function startDashboard() {
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

      // Reset stats
      maxSpeed = 0;
      maxGForce = 0;
      altitudeHistory = [];
      gpsStatus = 'waiting';
      updateGpsStatus('waiting');
      updateDisplay(0, null, null);

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

      // Start accelerometer
      if (window.DeviceMotionEvent) {
        motionListener = onDeviceMotion;
        window.addEventListener('devicemotion', motionListener);
      }

      // Start compass for heading when stationary
      if (window.DeviceOrientationEvent) {
        orientationListener = onDeviceOrientation;
        window.addEventListener('deviceorientation', orientationListener);
      }
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
      if (motionListener) {
        window.removeEventListener('devicemotion', motionListener);
        motionListener = null;
      }
      if (orientationListener) {
        window.removeEventListener('deviceorientation', orientationListener);
        orientationListener = null;
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
    const { speed, altitude, heading } = pos.coords;
    lastGpsTime = Date.now();
    updateGpsStatus('active');

    let speedKmh = 0;
    if (speed !== null && speed >= 0) {
      speedKmh = speed * 3.6;
    }
    if (speedKmh > maxSpeed) maxSpeed = speedKmh;

    const alt = altitude !== null ? Math.round(altitude) : null;
    if (alt !== null) {
      const now = Date.now();
      altitudeHistory.push({ time: now, alt: alt });
      // Trim to last 30 minutes
      const cutoff = now - ALT_HISTORY_MS;
      while (altitudeHistory.length > 0 && altitudeHistory[0].time < cutoff) {
        altitudeHistory.shift();
      }
    }

    // GPS heading is reliable when moving (>5 km/h)
    lastGpsSpeed = speedKmh;
    if (heading !== null && speedKmh > 5) {
      gpsHeading = heading;
    }

    // Use GPS heading when moving, compass when stationary
    const bestHeading = (speedKmh > 5 && gpsHeading !== null) ? gpsHeading : compassHeading;
    const hdg = bestHeading !== null ? Math.round(bestHeading) : null;
    updateDisplay(speedKmh, alt, hdg);
    drawAltitudeChart();
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

  function onDeviceMotion(event) {
    const accel = event.acceleration;
    if (!accel) return;

    const G = 9.81;
    gForceX = (accel.x || 0) / G;
    gForceY = (accel.y || 0) / G;

    const totalG = Math.sqrt(gForceX * gForceX + gForceY * gForceY);
    if (totalG > maxGForce) maxGForce = totalG;

    updateGForce(gForceX, gForceY);
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
        const hdg = Math.round(heading);
        const headingEl = document.getElementById('dash-heading-value');
        if (headingEl) {
          const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
          const idx = Math.round(hdg / 45) % 8;
          headingEl.textContent = `${dirs[idx]} ${hdg}°`;
        }
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

  function updateGForce(gx, gy) {
    const dot = document.getElementById('dash-gforce-dot');
    const gVal = document.getElementById('dash-gforce-value');
    const maxGEl = document.getElementById('dash-max-gforce');
    if (!dot) return;

    const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
    const maxG = 2;
    const nx = clamp(gx / maxG, -1, 1);
    const ny = clamp(-gy / maxG, -1, 1);

    dot.style.left = `${50 + nx * 45}%`;
    dot.style.top = `${50 + ny * 45}%`;

    const totalG = Math.sqrt(gx * gx + gy * gy);
    gVal.textContent = totalG.toFixed(1);
    maxGEl.textContent = maxGForce.toFixed(1);

    if (totalG > 1.5) {
      dot.style.background = '#ff5252';
      dot.style.boxShadow = '0 0 12px rgba(255,82,82,0.8)';
    } else if (totalG > 0.8) {
      dot.style.background = '#ff9800';
      dot.style.boxShadow = '0 0 12px rgba(255,152,0,0.6)';
    } else {
      dot.style.background = 'var(--accent)';
      dot.style.boxShadow = '0 0 12px rgba(0,200,83,0.6)';
    }
  }

  function drawAltitudeChart() {
    const canvas = document.getElementById('dash-altitude-chart');
    if (!canvas || altitudeHistory.length < 2) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    const pts = altitudeHistory;
    const now = Date.now();
    const windowStart = now - ALT_HISTORY_MS;

    const alts = pts.map(p => p.alt);
    const minAlt = Math.min(...alts) - 20;
    const maxAlt = Math.max(...alts) + 20;
    const range = maxAlt - minAlt || 1;

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (i / 4) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Draw altitude fill
    ctx.beginPath();
    ctx.moveTo(0, h);
    pts.forEach((p, i) => {
      const x = ((p.time - windowStart) / ALT_HISTORY_MS) * w;
      const y = h - ((p.alt - minAlt) / range) * (h - 8);
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    });
    const lastX = ((pts[pts.length - 1].time - windowStart) / ALT_HISTORY_MS) * w;
    ctx.lineTo(lastX, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,200,83,0.12)';
    ctx.fill();

    // Draw altitude line
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = ((p.time - windowStart) / ALT_HISTORY_MS) * w;
      const y = h - ((p.alt - minAlt) / range) * (h - 8);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#00c853';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Min/max labels
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(maxAlt)}m`, w - 4, 12);
    ctx.fillText(`${Math.round(minAlt)}m`, w - 4, h - 4);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
  } else {
    initDashboard();
  }
})();
