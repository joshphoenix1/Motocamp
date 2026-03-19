/* ===== Ventusky-Style Weather Module ===== */
const Weather = {
  gridData: null,
  currentLayer: null,
  overlayCanvas: null,
  windCanvas: null,
  animationTimer: null,
  windAnimFrame: null,
  currentHourOffset: 0,
  activeType: null,
  particles: [],
  map: null,

  // NZ grid at ~0.25° resolution for smooth interpolation
  gridLats: (() => { const a = []; for (let lat = -47.5; lat <= -34; lat += 0.25) a.push(lat); return a; })(),
  gridLons: (() => { const a = []; for (let lon = 165; lon <= 179; lon += 0.25) a.push(lon); return a; })(),

  // Color scales (Ventusky-style continuous gradients)
  tempScale: [
    { val: -10, r: 0, g: 0, b: 255 },
    { val: -5,  r: 0, g: 100, b: 255 },
    { val: 0,   r: 0, g: 200, b: 255 },
    { val: 5,   r: 0, g: 210, b: 180 },
    { val: 10,  r: 0, g: 220, b: 0 },
    { val: 15,  r: 127, g: 255, b: 0 },
    { val: 20,  r: 255, g: 255, b: 0 },
    { val: 25,  r: 255, g: 165, b: 0 },
    { val: 30,  r: 255, g: 69, b: 0 },
    { val: 35,  r: 255, g: 0, b: 0 },
    { val: 40,  r: 139, g: 0, b: 0 },
  ],

  rainScale: [
    { val: 0,   r: 0, g: 0, b: 0, a: 0 },
    { val: 0.1, r: 160, g: 216, b: 239, a: 0.3 },
    { val: 0.5, r: 74, g: 144, b: 217, a: 0.5 },
    { val: 1,   r: 46, g: 92, b: 184, a: 0.6 },
    { val: 2,   r: 106, g: 61, b: 154, a: 0.65 },
    { val: 5,   r: 255, g: 102, b: 0, a: 0.7 },
    { val: 10,  r: 255, g: 0, b: 0, a: 0.75 },
    { val: 20,  r: 255, g: 0, b: 255, a: 0.8 },
  ],

  windScale: [
    { val: 0,  r: 99, g: 179, b: 237 },
    { val: 2,  r: 72, g: 187, b: 120 },
    { val: 5,  r: 236, g: 201, b: 75 },
    { val: 8,  r: 237, g: 137, b: 54 },
    { val: 12, r: 245, g: 101, b: 101 },
    { val: 18, r: 197, g: 48, b: 48 },
    { val: 25, r: 159, g: 122, b: 234 },
  ],

  cloudScale: [
    { val: 0,   r: 0, g: 0, b: 0, a: 0 },
    { val: 20,  r: 180, g: 190, b: 200, a: 0.1 },
    { val: 50,  r: 180, g: 190, b: 200, a: 0.3 },
    { val: 80,  r: 170, g: 175, b: 185, a: 0.45 },
    { val: 100, r: 160, g: 165, b: 170, a: 0.55 },
  ],

  // Interpolate color from a scale
  getColor(val, scale) {
    if (val <= scale[0].val) return scale[0];
    if (val >= scale[scale.length - 1].val) return scale[scale.length - 1];
    for (let i = 0; i < scale.length - 1; i++) {
      if (val >= scale[i].val && val <= scale[i + 1].val) {
        const t = (val - scale[i].val) / (scale[i + 1].val - scale[i].val);
        return {
          r: Math.round(scale[i].r + t * (scale[i + 1].r - scale[i].r)),
          g: Math.round(scale[i].g + t * (scale[i + 1].g - scale[i].g)),
          b: Math.round(scale[i].b + t * (scale[i + 1].b - scale[i].b)),
          a: scale[i].a != null ? scale[i].a + t * ((scale[i + 1].a || 1) - scale[i].a) : undefined,
        };
      }
    }
    return scale[0];
  },

  // Fetch weather for grid points from Open-Meteo
  async fetchGridWeather() {
    const points = [];
    for (const lat of this.gridLats) {
      for (const lon of this.gridLons) {
        points.push({ lat, lon });
      }
    }

    // Open-Meteo multi-location: batch in chunks of 50
    const chunkSize = 50;
    const allData = [];

    for (let i = 0; i < points.length; i += chunkSize) {
      const chunk = points.slice(i, i + chunkSize);
      const latStr = chunk.map(p => p.lat).join(',');
      const lonStr = chunk.map(p => p.lon).join(',');

      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${latStr}&longitude=${lonStr}` +
          '&hourly=temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,cloud_cover,weather_code' +
          '&wind_speed_unit=ms&timezone=Pacific%2FAuckland&forecast_days=7';

        const resp = await fetch(url);
        const data = await resp.json();

        if (Array.isArray(data)) {
          allData.push(...data);
        } else if (data.hourly) {
          allData.push(data);
        }
      } catch (e) {
        // Fill missing with nulls
        for (let j = 0; j < chunk.length; j++) allData.push(null);
      }
    }

    // Build 2D grid [latIdx][lonIdx] = hourly data
    const nLon = this.gridLons.length;
    this.gridData = [];
    for (let li = 0; li < this.gridLats.length; li++) {
      this.gridData[li] = [];
      for (let lj = 0; lj < nLon; lj++) {
        const idx = li * nLon + lj;
        this.gridData[li][lj] = allData[idx]?.hourly || null;
      }
    }

    console.log(`Weather grid: ${this.gridLats.length}x${nLon} = ${allData.length} points loaded`);
    return this.gridData;
  },

  // Bilinear interpolation of grid value at arbitrary lat/lon
  interpolate(lat, lon, field, hourIdx) {
    const latIdx = (lat - this.gridLats[0]) / (this.gridLats[1] - this.gridLats[0]);
    const lonIdx = (lon - this.gridLons[0]) / (this.gridLons[1] - this.gridLons[0]);

    const li = Math.floor(latIdx);
    const lj = Math.floor(lonIdx);

    if (li < 0 || li >= this.gridLats.length - 1 || lj < 0 || lj >= this.gridLons.length - 1) return null;

    const tLat = latIdx - li;
    const tLon = lonIdx - lj;

    const get = (i, j) => {
      const d = this.gridData[i]?.[j];
      return d?.[field]?.[hourIdx] ?? null;
    };

    const v00 = get(li, lj);
    const v10 = get(li + 1, lj);
    const v01 = get(li, lj + 1);
    const v11 = get(li + 1, lj + 1);

    if (v00 == null || v10 == null || v01 == null || v11 == null) return null;

    return v00 * (1 - tLat) * (1 - tLon) +
           v10 * tLat * (1 - tLon) +
           v01 * (1 - tLat) * tLon +
           v11 * tLat * tLon;
  },

  // Interpolate wind vector (u, v) from speed + direction
  interpolateWind(lat, lon, hourIdx) {
    const speed = this.interpolate(lat, lon, 'wind_speed_10m', hourIdx);
    const dir = this.interpolate(lat, lon, 'wind_direction_10m', hourIdx);
    if (speed == null || dir == null) return null;
    const rad = dir * Math.PI / 180;
    return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad), speed };
  },

  // Create/update overlay
  createOverlay(map, type, hourOffset) {
    this.map = map;
    this.activeType = type;
    this.currentHourOffset = hourOffset || 0;

    if (!this.gridData) return;

    // Create overlay canvas if needed
    if (!this.overlayCanvas) {
      this.overlayCanvas = document.createElement('canvas');
      this.overlayCanvas.id = 'weather-overlay';
      this.overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:400;';
      map.getContainer().appendChild(this.overlayCanvas);

      map.on('moveend', () => this.render());
      map.on('zoomend', () => this.render());
      map.on('resize', () => this.resizeCanvas());
    }

    // Wind particle canvas
    if (!this.windCanvas && type === 'wind') {
      this.windCanvas = document.createElement('canvas');
      this.windCanvas.id = 'wind-particles';
      this.windCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:401;';
      map.getContainer().appendChild(this.windCanvas);
    }

    this.resizeCanvas();
    this.render();

    if (type === 'wind') {
      this.startWindAnimation();
    } else {
      this.stopWindAnimation();
    }
  },

  resizeCanvas() {
    if (!this.map) return;
    const size = this.map.getSize();
    if (this.overlayCanvas) {
      this.overlayCanvas.width = size.x;
      this.overlayCanvas.height = size.y;
    }
    if (this.windCanvas) {
      this.windCanvas.width = size.x;
      this.windCanvas.height = size.y;
    }
  },

  // Render the weather overlay with bilinear interpolation
  render() {
    if (!this.overlayCanvas || !this.gridData || !this.activeType) return;

    const canvas = this.overlayCanvas;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const map = this.map;
    const bounds = map.getBounds();
    const hourIdx = Math.min(this.currentHourOffset, 167);

    // Determine render resolution (render at lower res for performance, then scale)
    const zoom = map.getZoom();
    const step = zoom >= 10 ? 2 : zoom >= 8 ? 3 : zoom >= 6 ? 4 : 6;

    const fieldMap = {
      temperature: 'temperature_2m',
      precipitation: 'precipitation',
      wind: 'wind_speed_10m',
      clouds: 'cloud_cover'
    };

    const field = fieldMap[this.activeType];
    const scaleMap = {
      temperature: this.tempScale,
      precipitation: this.rainScale,
      wind: this.windScale,
      clouds: this.cloudScale
    };
    const scale = scaleMap[this.activeType];
    const baseAlpha = this.activeType === 'temperature' ? 0.55 :
                      this.activeType === 'wind' ? 0.45 : 0.65;

    // Create ImageData for pixel manipulation
    const imgData = ctx.createImageData(w, h);
    const pixels = imgData.data;

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const latlng = map.containerPointToLatLng([px, py]);
        const val = this.interpolate(latlng.lat, latlng.lng, field, hourIdx);

        if (val == null) continue;

        const color = this.getColor(val, scale);
        const alpha = color.a != null ? color.a : baseAlpha;

        if (alpha <= 0.01) continue;

        // Fill step x step block
        for (let dy = 0; dy < step && py + dy < h; dy++) {
          for (let dx = 0; dx < step && px + dx < w; dx++) {
            const idx = ((py + dy) * w + (px + dx)) * 4;
            pixels[idx] = color.r;
            pixels[idx + 1] = color.g;
            pixels[idx + 2] = color.b;
            pixels[idx + 3] = Math.round(alpha * 255);
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Soften with a blur for smooth gradient effect
    if (step > 2) {
      ctx.globalAlpha = 1;
      ctx.filter = `blur(${step * 1.5}px)`;
      ctx.drawImage(canvas, 0, 0);
      ctx.filter = 'none';
    }
  },

  // Wind particle animation
  startWindAnimation() {
    this.stopWindAnimation();
    if (!this.windCanvas) return;

    const PARTICLE_COUNT = 4000;
    const MAX_AGE = 80;
    const FADE = 0.97;
    const LINE_WIDTH = 0.8;

    // Initialize particles
    const canvas = this.windCanvas;
    const w = canvas.width;
    const h = canvas.height;

    this.particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this.particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        age: Math.floor(Math.random() * MAX_AGE)
      });
    }

    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = LINE_WIDTH;

    const animate = () => {
      // Fade existing trails
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = `rgba(0,0,0,${FADE})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';

      const map = this.map;
      const hourIdx = Math.min(this.currentHourOffset, 167);
      const zoom = map.getZoom();
      const speedFactor = Math.max(0.3, 1.5 - zoom * 0.1);

      ctx.beginPath();

      for (const p of this.particles) {
        if (p.age >= MAX_AGE) {
          // Respawn
          p.x = Math.random() * w;
          p.y = Math.random() * h;
          p.age = 0;
          continue;
        }

        const latlng = map.containerPointToLatLng([p.x, p.y]);
        const wind = this.interpolateWind(latlng.lat, latlng.lng, hourIdx);

        if (!wind) {
          p.age = MAX_AGE;
          continue;
        }

        const oldX = p.x;
        const oldY = p.y;

        // Convert wind vector to pixel displacement
        p.x += wind.u * speedFactor;
        p.y -= wind.v * speedFactor; // y is inverted in screen coords

        p.age++;

        // Skip if off screen
        if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
          p.age = MAX_AGE;
          continue;
        }

        ctx.moveTo(oldX, oldY);
        ctx.lineTo(p.x, p.y);
      }

      ctx.stroke();
      this.windAnimFrame = requestAnimationFrame(animate);
    };

    this.windAnimFrame = requestAnimationFrame(animate);
  },

  stopWindAnimation() {
    if (this.windAnimFrame) {
      cancelAnimationFrame(this.windAnimFrame);
      this.windAnimFrame = null;
    }
    if (this.windCanvas) {
      const ctx = this.windCanvas.getContext('2d');
      ctx.clearRect(0, 0, this.windCanvas.width, this.windCanvas.height);
    }
  },

  removeOverlay() {
    this.stopWindAnimation();
    this.stopAnimation();
    this.activeType = null;
    if (this.overlayCanvas) {
      const ctx = this.overlayCanvas.getContext('2d');
      ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    }
    if (this.windCanvas) {
      const ctx = this.windCanvas.getContext('2d');
      ctx.clearRect(0, 0, this.windCanvas.width, this.windCanvas.height);
    }
  },

  // Timeline playback animation
  startAnimation(type) {
    this.stopAnimation();
    let hour = this.currentHourOffset;
    this.animationTimer = setInterval(() => {
      hour = (hour + 3) % 168;
      this.currentHourOffset = hour;
      this.render();

      const slider = document.getElementById('weather-timeline-slider');
      const sideSlider = document.getElementById('weather-time-slider');
      if (slider) slider.value = hour;
      if (sideSlider) sideSlider.value = hour;

      this.updateTimeLabel(hour);
    }, 600);
  },

  stopAnimation() {
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
  },

  updateTimeLabel(hourOffset) {
    const now = new Date();
    now.setHours(now.getHours() + hourOffset);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const label = hourOffset === 0 ? 'Now' :
      `${dayNames[now.getDay()]} ${now.getHours().toString().padStart(2, '0')}:00`;

    const el1 = document.getElementById('weather-time-label');
    const el2 = document.getElementById('weather-timeline-time');
    if (el1) el1.textContent = label;
    if (el2) el2.textContent = label;
  },

  // Fetch point weather (for info panels and route planning)
  async fetchPointWeather(lat, lon) {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        '&hourly=temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,' +
        'weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,uv_index' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,' +
        'wind_speed_10m_max,sunrise,sunset,uv_index_max' +
        '&wind_speed_unit=ms&timezone=Pacific%2FAuckland&forecast_days=7';

      const resp = await fetch(url);
      return await resp.json();
    } catch (e) {
      console.warn('Point weather fetch failed:', e);
      return null;
    }
  },

  // Build weather HTML for info panels
  buildWeatherHTML(data) {
    if (!data?.daily) return '<p style="color:var(--text-muted)">Weather data unavailable</p>';

    let html = '<div class="weather-grid">';
    const days = Math.min(7, data.daily.time.length);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let i = 0; i < days; i++) {
      const d = new Date(data.daily.time[i]);
      const wx = Utils.getWeatherInfo(data.daily.weather_code[i]);
      html += `
        <div class="weather-item">
          <div class="wx-day">${i === 0 ? 'Today' : dayNames[d.getDay()]}</div>
          <div class="wx-icon">${wx.icon}</div>
          <div class="wx-temp">${Math.round(data.daily.temperature_2m_max[i])}°</div>
          <div class="wx-desc">${Math.round(data.daily.temperature_2m_min[i])}° low</div>
          <div class="wx-desc">${data.daily.precipitation_sum[i].toFixed(1)}mm</div>
        </div>`;
    }
    html += '</div>';
    return html;
  },

  // Build weather legend
  buildLegendHTML(type) {
    const makeBar = (stops) => {
      const gradientStops = stops.map((s, i) => {
        const pct = (i / (stops.length - 1)) * 100;
        const a = s.a != null ? s.a : 1;
        return `rgba(${s.r},${s.g},${s.b},${a}) ${pct}%`;
      }).join(', ');

      return `<div style="height:14px;border-radius:7px;background:linear-gradient(to right, ${gradientStops});margin-bottom:4px"></div>`;
    };

    switch (type) {
      case 'temperature':
        return makeBar(this.tempScale) +
          '<div class="weather-legend-labels"><span>-10°C</span><span>0°C</span><span>10°C</span><span>20°C</span><span>30°C</span><span>40°C</span></div>';
      case 'precipitation':
        return makeBar(this.rainScale) +
          '<div class="weather-legend-labels"><span>0mm</span><span>0.5mm</span><span>2mm</span><span>5mm</span><span>10mm</span><span>20mm+</span></div>';
      case 'wind':
        return makeBar(this.windScale) +
          '<div class="weather-legend-labels"><span>Calm</span><span>5m/s</span><span>10m/s</span><span>15m/s</span><span>25m/s+</span></div>';
      case 'clouds':
        return makeBar(this.cloudScale) +
          '<div class="weather-legend-labels"><span>Clear</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>';
      default:
        return '';
    }
  }
};
