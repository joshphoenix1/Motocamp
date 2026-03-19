/* ===== Ventusky-Style Weather Module (OWM Tiles + Wind Particles) ===== */
const Weather = {
  OWM_KEY: 'a7f9211eca3e2d5976f41c4a64ad769b',
  map: null,
  activeType: null,
  activeTileLayer: null,
  currentHourOffset: 0,
  animationTimer: null,
  gridData: null,

  // Wind particle system
  windCanvas: null,
  windAnimFrame: null,
  particles: [],
  windGrid: null,

  // Coarse grid for wind vectors only (~90 points, 2 API calls)
  windGridLats: (() => { const a = []; for (let lat = -47; lat <= -34; lat += 1.5) a.push(lat); return a; })(),
  windGridLons: (() => { const a = []; for (let lon = 165; lon <= 179; lon += 1.5) a.push(lon); return a; })(),

  // OWM weather map tile layer names
  owmTiles: {
    temperature: 'temp_new',
    precipitation: 'precipitation_new',
    wind: 'wind_new',
    clouds: 'clouds_new',
  },

  // Fetch coarse wind grid from Open-Meteo (for particle animation)
  async fetchGridWeather() {
    const points = [];
    for (const lat of this.windGridLats) {
      for (const lon of this.windGridLons) {
        points.push({ lat, lon });
      }
    }

    const chunkSize = 50;
    const allData = [];

    for (let i = 0; i < points.length; i += chunkSize) {
      const chunk = points.slice(i, i + chunkSize);
      const latStr = chunk.map(p => p.lat).join(',');
      const lonStr = chunk.map(p => p.lon).join(',');

      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${latStr}&longitude=${lonStr}` +
          '&hourly=wind_speed_10m,wind_direction_10m' +
          '&wind_speed_unit=ms&timezone=Pacific%2FAuckland&forecast_days=7';

        const resp = await fetch(url);
        const data = await resp.json();

        if (Array.isArray(data)) allData.push(...data);
        else if (data.hourly) allData.push(data);
      } catch (e) {
        for (let j = 0; j < chunk.length; j++) allData.push(null);
      }
    }

    const nLon = this.windGridLons.length;
    this.windGrid = [];
    for (let li = 0; li < this.windGridLats.length; li++) {
      this.windGrid[li] = [];
      for (let lj = 0; lj < nLon; lj++) {
        const idx = li * nLon + lj;
        this.windGrid[li][lj] = allData[idx]?.hourly || null;
      }
    }

    this.gridData = this.windGrid;
    console.log(`Wind grid loaded: ${this.windGridLats.length}x${nLon} = ${allData.length} points`);
  },

  // Bilinear interpolation of wind at arbitrary lat/lon
  interpolateWind(lat, lon, hourIdx) {
    if (!this.windGrid) return null;

    const latStep = this.windGridLats[1] - this.windGridLats[0];
    const lonStep = this.windGridLons[1] - this.windGridLons[0];
    const latIdx = (lat - this.windGridLats[0]) / latStep;
    const lonIdx = (lon - this.windGridLons[0]) / lonStep;

    const li = Math.floor(latIdx);
    const lj = Math.floor(lonIdx);

    if (li < 0 || li >= this.windGridLats.length - 1 || lj < 0 || lj >= this.windGridLons.length - 1) return null;

    const tLat = latIdx - li;
    const tLon = lonIdx - lj;

    const getVal = (i, j, field) => this.windGrid[i]?.[j]?.[field]?.[hourIdx] ?? null;

    const s00 = getVal(li, lj, 'wind_speed_10m'), s10 = getVal(li + 1, lj, 'wind_speed_10m');
    const s01 = getVal(li, lj + 1, 'wind_speed_10m'), s11 = getVal(li + 1, lj + 1, 'wind_speed_10m');
    const d00 = getVal(li, lj, 'wind_direction_10m'), d10 = getVal(li + 1, lj, 'wind_direction_10m');
    const d01 = getVal(li, lj + 1, 'wind_direction_10m'), d11 = getVal(li + 1, lj + 1, 'wind_direction_10m');

    if (s00 == null || s10 == null || s01 == null || s11 == null) return null;
    if (d00 == null || d10 == null || d01 == null || d11 == null) return null;

    const speed = s00 * (1 - tLat) * (1 - tLon) + s10 * tLat * (1 - tLon) +
                  s01 * (1 - tLat) * tLon + s11 * tLat * tLon;
    const dir = d00 * (1 - tLat) * (1 - tLon) + d10 * tLat * (1 - tLon) +
                d01 * (1 - tLat) * tLon + d11 * tLat * tLon;

    const rad = dir * Math.PI / 180;
    return { u: -speed * Math.sin(rad), v: -speed * Math.cos(rad), speed };
  },

  // Create weather overlay using OWM tiles
  createOverlay(map, type, hourOffset) {
    this.map = map;
    this.activeType = type;
    this.currentHourOffset = hourOffset || 0;

    // Remove old tile layer
    if (this.activeTileLayer) {
      map.removeLayer(this.activeTileLayer);
      this.activeTileLayer = null;
    }

    // Remove old canvas overlay if it exists from previous version
    const oldCanvas = document.getElementById('weather-overlay');
    if (oldCanvas) oldCanvas.remove();

    // Add OWM tile layer
    const owmLayer = this.owmTiles[type];
    if (owmLayer) {
      this.activeTileLayer = L.tileLayer(
        `https://tile.openweathermap.org/map/${owmLayer}/{z}/{x}/{y}.png?appid=${this.OWM_KEY}`,
        {
          opacity: 1.0,
          maxZoom: 18,
          zIndex: 400,
          attribution: '&copy; OpenWeatherMap',
          className: `weather-tile-${type}`
        }
      );
      map.addLayer(this.activeTileLayer);
    }

    // Wind particles on top of wind tile layer
    if (type === 'wind' && this.windGrid) {
      if (!this.windCanvas) {
        this.windCanvas = document.createElement('canvas');
        this.windCanvas.id = 'wind-particles';
        this.windCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:401;';
        map.getContainer().appendChild(this.windCanvas);
      }
      this.resizeCanvas();
      this.startWindAnimation();

      // Re-sync canvas on map move/resize
      if (!this._boundMove) {
        this._boundMove = () => { this.resizeCanvas(); this.resetParticles(); };
        this._boundResize = () => this.resizeCanvas();
        map.on('moveend', this._boundMove);
        map.on('resize', this._boundResize);
      }
    } else {
      this.stopWindAnimation();
    }
  },

  resizeCanvas() {
    if (!this.map || !this.windCanvas) return;
    const size = this.map.getSize();
    this.windCanvas.width = size.x;
    this.windCanvas.height = size.y;
  },

  resetParticles() {
    if (!this.windCanvas) return;
    const w = this.windCanvas.width;
    const h = this.windCanvas.height;
    for (const p of this.particles) {
      p.x = Math.random() * w;
      p.y = Math.random() * h;
      p.age = Math.floor(Math.random() * 80);
    }
  },

  render() {
    // OWM tiles show current conditions only
    // Wind particles update automatically via currentHourOffset
    this.updateTimeLabel(this.currentHourOffset);
  },

  // Wind particle animation (Ventusky-style flowing lines)
  startWindAnimation() {
    this.stopWindAnimation();
    if (!this.windCanvas || !this.windGrid) return;

    const PARTICLE_COUNT = 5000;
    const MAX_AGE = 150;
    const FADE = 0.985;

    const canvas = this.windCanvas;

    this.particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this.particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        age: Math.floor(Math.random() * MAX_AGE)
      });
    }

    const ctx = canvas.getContext('2d');

    const animate = () => {
      const w = canvas.width;
      const h = canvas.height;

      // Fade trails
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = `rgba(0,0,0,${FADE})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';

      const map = this.map;
      const hourIdx = Math.min(this.currentHourOffset, 167);
      const zoom = map.getZoom();
      const speedFactor = Math.max(0.12, 0.6 - zoom * 0.04);

      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 0.8;

      for (const p of this.particles) {
        if (p.age >= MAX_AGE) {
          p.x = Math.random() * w;
          p.y = Math.random() * h;
          p.age = 0;
          continue;
        }

        const latlng = map.containerPointToLatLng([p.x, p.y]);
        const wind = this.interpolateWind(latlng.lat, latlng.lng, hourIdx);

        if (!wind) { p.age = MAX_AGE; continue; }

        const oldX = p.x;
        const oldY = p.y;

        p.x += wind.u * speedFactor;
        p.y -= wind.v * speedFactor;
        p.age++;

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
    if (this.activeTileLayer && this.map) {
      this.map.removeLayer(this.activeTileLayer);
      this.activeTileLayer = null;
    }
  },

  // Timeline playback (cycles through forecast hours)
  startAnimation(type) {
    this.stopAnimation();
    let hour = this.currentHourOffset;
    this.animationTimer = setInterval(() => {
      hour = (hour + 1) % 168;
      this.currentHourOffset = hour;

      const slider = document.getElementById('weather-timeline-slider');
      const sideSlider = document.getElementById('weather-time-slider');
      if (slider) slider.value = hour;
      if (sideSlider) sideSlider.value = hour;

      this.updateTimeLabel(hour);
    }, 150);
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

  // Fetch point weather for info panels (Open-Meteo, single point)
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

  // Build 7-day forecast HTML for info panels
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

  // Build legend HTML matching OWM tile colors
  buildLegendHTML(type) {
    const legends = {
      temperature: {
        gradient: 'linear-gradient(to right, #821692, #0000ff, #00ccff, #00ff88, #88ff00, #ffcc00, #ff6600, #ff0000, #8b0000)',
        labels: '<span>-40°C</span><span>-20°C</span><span>0°C</span><span>10°C</span><span>20°C</span><span>30°C</span><span>40°C</span>'
      },
      precipitation: {
        gradient: 'linear-gradient(to right, rgba(225,200,100,0.2), rgba(200,150,0,0.5), rgba(150,100,0,0.6), rgba(120,20,0,0.7), rgba(255,0,128,0.8), rgba(170,0,220,0.9))',
        labels: '<span>0mm</span><span>0.5mm</span><span>1mm</span><span>5mm</span><span>10mm</span><span>50mm+</span>'
      },
      wind: {
        gradient: 'linear-gradient(to right, #63b3ed, #48bb78, #ecc94b, #ed8936, #f56565, #c53030, #9f7aea)',
        labels: '<span>Calm</span><span>5m/s</span><span>10m/s</span><span>15m/s</span><span>25m/s+</span>'
      },
      clouds: {
        gradient: 'linear-gradient(to right, rgba(255,255,255,0), rgba(200,210,220,0.4), rgba(160,170,180,0.7), rgba(130,140,150,0.9))',
        labels: '<span>Clear</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>'
      }
    };

    const l = legends[type] || legends.temperature;
    return `<div style="height:14px;border-radius:7px;background:${l.gradient};margin-bottom:4px;border:1px solid rgba(255,255,255,0.1)"></div>` +
      `<div class="weather-legend-labels">${l.labels}</div>`;
  }
};
