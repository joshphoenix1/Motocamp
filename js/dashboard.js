// ===== GPS Dashboard - Speedometer, Altitude & G-Force =====
(function() {
  'use strict';

  let watchId = null;
  let lastSpeed = 0;
  let maxSpeed = 0;
  let lastVelocities = [];
  let lastTimestamp = null;
  let gForceX = 0, gForceY = 0, gForceZ = 0;
  let maxGForce = 0;
  let motionListener = null;
  let wakeLock = null;
  let altitudeHistory = [];
  const MAX_ALT_POINTS = 120;

  function initDashboard() {
    const btn = document.getElementById('btn-dashboard');
    const mobileBtn = document.getElementById('mobile-dashboard');
    const closeBtn = document.getElementById('dashboard-close');

    if (btn) btn.addEventListener('click', openDashboard);
    if (mobileBtn) mobileBtn.addEventListener('click', openDashboard);
    if (closeBtn) closeBtn.addEventListener('click', closeDashboard);
  }

  function openDashboard() {
    try {
      const overlay = document.getElementById('dashboard-overlay');
      overlay.classList.remove('hidden');
      overlay.style.display = 'flex';

      const btn = document.getElementById('btn-dashboard');
      if (btn) btn.classList.add('active');

      // Hide everything else — this is a full takeover
      document.body.classList.add('dashboard-active');

      // Request wake lock to keep screen on
      requestWakeLock();

      // Try fullscreen (may not work on iOS)
      try {
        const el = document.documentElement;
        if (el.requestFullscreen) {
          el.requestFullscreen().catch(() => {});
        } else if (el.webkitRequestFullscreen) {
          el.webkitRequestFullscreen();
        }
      } catch (e) { /* ignore */ }

      // Start GPS tracking
      if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 10000
        });
      }

      // Start accelerometer for g-force
      if (window.DeviceMotionEvent) {
        motionListener = onDeviceMotion;
        window.addEventListener('devicemotion', motionListener);
      }

      // Reset stats
      maxSpeed = 0;
      maxGForce = 0;
      altitudeHistory = [];
      updateDisplay(0, null, 0, 0);
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

      // Restore everything
      document.body.classList.remove('dashboard-active');

      // Stop GPS
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }

      // Stop accelerometer
      if (motionListener) {
        window.removeEventListener('devicemotion', motionListener);
        motionListener = null;
      }

      // Release wake lock
      releaseWakeLock();

      // Exit fullscreen
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

  // Re-acquire wake lock on visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && watchId !== null) {
      requestWakeLock();
    }
  });

  function onPosition(pos) {
    const { speed, altitude, heading } = pos.coords;

    // Speed in m/s from GPS, convert to km/h
    let speedKmh = 0;
    if (speed !== null && speed >= 0) {
      speedKmh = speed * 3.6;
    }

    // Smooth speed a bit
    lastSpeed = speedKmh;
    if (speedKmh > maxSpeed) maxSpeed = speedKmh;

    // Altitude
    const alt = altitude !== null ? Math.round(altitude) : null;
    if (alt !== null) {
      altitudeHistory.push(alt);
      if (altitudeHistory.length > MAX_ALT_POINTS) altitudeHistory.shift();
    }

    // Heading
    const hdg = heading !== null ? Math.round(heading) : null;

    updateDisplay(speedKmh, alt, gForceX, gForceY, hdg);
    drawAltitudeChart();
  }

  function onGeoError(err) {
    console.warn('Dashboard GPS error:', err.message);
  }

  function onDeviceMotion(event) {
    const accel = event.accelerationIncludingGravity;
    if (!accel) return;

    // Convert to g-force (9.81 m/s² = 1g)
    const G = 9.81;
    gForceX = (accel.x || 0) / G;  // lateral
    gForceY = (accel.y || 0) / G;  // longitudinal
    gForceZ = (accel.z || 0) / G;  // vertical

    const totalG = Math.sqrt(gForceX * gForceX + gForceY * gForceY) ;
    if (totalG > maxGForce) maxGForce = totalG;

    updateGForce(gForceX, gForceY);
  }

  function updateDisplay(speedKmh, altitude, gx, gy, heading) {
    // Speed
    const speedVal = document.getElementById('dash-speed-value');
    const speedNeedle = document.getElementById('dash-speed-needle');
    const maxSpeedEl = document.getElementById('dash-max-speed');

    const displaySpeed = Math.round(speedKmh);
    speedVal.textContent = displaySpeed;
    maxSpeedEl.textContent = Math.round(maxSpeed);

    // Needle rotation: 0 km/h = -135deg, 200 km/h = 135deg
    const maxGaugeSpeed = 200;
    const ratio = Math.min(speedKmh / maxGaugeSpeed, 1);
    const angle = -135 + (ratio * 270);
    speedNeedle.style.transform = `rotate(${angle}deg)`;

    // Speed arc color
    const speedArc = document.getElementById('dash-speed-arc');
    if (speedArc) {
      const pct = ratio * 100;
      speedArc.style.background = `conic-gradient(
        from 202.5deg,
        var(--accent) 0%,
        ${pct > 60 ? '#ff9800' : 'var(--accent)'} ${pct * 0.75}%,
        ${pct > 80 ? '#ff5252' : pct > 60 ? '#ff9800' : 'var(--accent)'} ${pct * 0.75}%,
        transparent ${pct * 0.75}%,
        transparent 75%
      )`;
    }

    // Altitude
    const altEl = document.getElementById('dash-altitude-value');
    altEl.textContent = altitude !== null ? altitude : '--';

    // Heading / compass
    const headingEl = document.getElementById('dash-heading-value');
    if (heading !== null) {
      const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
      const idx = Math.round(heading / 45) % 8;
      headingEl.textContent = `${dirs[idx]} ${heading}°`;
    } else {
      headingEl.textContent = '--';
    }
  }

  function updateGForce(gx, gy) {
    const dot = document.getElementById('dash-gforce-dot');
    const gVal = document.getElementById('dash-gforce-value');
    const maxGEl = document.getElementById('dash-max-gforce');

    if (!dot) return;

    // Clamp to 2G range, map to pixel position
    const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
    const maxG = 2;
    const nx = clamp(gx / maxG, -1, 1);
    const ny = clamp(-gy / maxG, -1, 1);  // invert Y for screen coords

    // Position dot (50% = center)
    dot.style.left = `${50 + nx * 45}%`;
    dot.style.top = `${50 + ny * 45}%`;

    const totalG = Math.sqrt(gx * gx + gy * gy);
    gVal.textContent = totalG.toFixed(1);
    maxGEl.textContent = maxGForce.toFixed(1);

    // Color based on g-force
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

    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.offsetWidth * 2;
    const h = canvas.height = canvas.offsetHeight * 2;
    ctx.scale(2, 2);
    const dw = canvas.offsetWidth;
    const dh = canvas.offsetHeight;

    ctx.clearRect(0, 0, dw, dh);

    const pts = altitudeHistory;
    const min = Math.min(...pts) - 10;
    const max = Math.max(...pts) + 10;
    const range = max - min || 1;

    // Draw fill
    ctx.beginPath();
    ctx.moveTo(0, dh);
    pts.forEach((p, i) => {
      const x = (i / (MAX_ALT_POINTS - 1)) * dw;
      const y = dh - ((p - min) / range) * (dh - 4);
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(((pts.length - 1) / (MAX_ALT_POINTS - 1)) * dw, dh);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,200,83,0.15)';
    ctx.fill();

    // Draw line
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = (i / (MAX_ALT_POINTS - 1)) * dw;
      const y = dh - ((p - min) / range) * (dh - 4);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#00c853';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
  } else {
    initDashboard();
  }
})();
