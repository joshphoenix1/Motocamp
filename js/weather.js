/* ===== Weather Module ===== */
const Weather = {
  gridData: null,
  currentLayer: null,
  canvasOverlay: null,
  animationTimer: null,
  currentHourOffset: 0,

  // NZ grid points for weather overlay (covers NZ at ~0.5° resolution)
  gridPoints: (() => {
    const points = [];
    for (let lat = -47.5; lat <= -34; lat += 0.5) {
      for (let lon = 165; lon <= 179; lon += 0.5) {
        points.push({ lat, lon });
      }
    }
    return points;
  })(),

  // Fetch weather for a grid of points from Open-Meteo
  async fetchGridWeather() {
    // Batch into chunks (Open-Meteo supports multi-location)
    const lats = this.gridPoints.map(p => p.lat).join(',');
    const lons = this.gridPoints.map(p => p.lon).join(',');

    // Open-Meteo has a limit, so fetch in chunks
    const chunkSize = 50;
    const allData = [];

    for (let i = 0; i < this.gridPoints.length; i += chunkSize) {
      const chunk = this.gridPoints.slice(i, i + chunkSize);
      const latStr = chunk.map(p => p.lat).join(',');
      const lonStr = chunk.map(p => p.lon).join(',');

      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${latStr}&longitude=${lonStr}` +
          '&hourly=temperature_2m,precipitation,wind_speed_10m,cloud_cover,weather_code' +
          '&wind_speed_unit=ms&timezone=Pacific%2FAuckland&forecast_days=7';

        const resp = await fetch(url);
        const data = await resp.json();

        // Handle single vs array response
        if (Array.isArray(data)) {
          allData.push(...data);
        } else if (data.hourly) {
          allData.push(data);
        }
      } catch (e) {
        console.warn('Weather chunk fetch failed:', e);
      }
    }

    // Map back to grid points
    this.gridData = this.gridPoints.map((point, i) => ({
      ...point,
      hourly: allData[i]?.hourly || null
    }));

    console.log(`Loaded weather for ${allData.length} grid points`);
    return this.gridData;
  },

  // Fetch weather for a specific point (for popups and route planning)
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

  // Create weather overlay on map using canvas
  createOverlay(map, type, hourOffset) {
    this.removeOverlay(map);
    if (!this.gridData) return;

    this.currentHourOffset = hourOffset || 0;

    const overlay = L.canvasOverlay()
      .drawing((canvasOverlay, params) => {
        const ctx = params.canvas.getContext('2d');
        ctx.clearRect(0, 0, params.canvas.width, params.canvas.height);

        const bounds = map.getBounds();
        const zoom = map.getZoom();
        const cellSize = Math.max(20, 60 - zoom * 4);

        for (const point of this.gridData) {
          if (!point.hourly) continue;
          if (!bounds.contains([point.lat, point.lon])) continue;

          const hourIdx = Math.min(this.currentHourOffset, (point.hourly.time?.length || 168) - 1);
          const pos = map.latLngToContainerPoint([point.lat, point.lon]);

          let color;
          let value;

          switch (type) {
            case 'temperature':
              value = point.hourly.temperature_2m?.[hourIdx];
              if (value == null) continue;
              color = Utils.tempColor(value);
              ctx.globalAlpha = 0.5;
              ctx.fillStyle = color;
              ctx.fillRect(pos.x - cellSize / 2, pos.y - cellSize / 2, cellSize, cellSize);

              // Label
              if (zoom >= 7) {
                ctx.globalAlpha = 0.9;
                ctx.fillStyle = '#fff';
                ctx.font = `${Math.max(9, 12 - (10 - zoom))}px Inter, sans-serif`;
                ctx.textAlign = 'center';
                ctx.fillText(`${Math.round(value)}°`, pos.x, pos.y + 4);
              }
              break;

            case 'precipitation':
              value = point.hourly.precipitation?.[hourIdx];
              if (value == null || value <= 0) continue;
              color = Utils.rainColor(value);
              ctx.globalAlpha = 0.7;
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(pos.x, pos.y, cellSize * 0.6, 0, Math.PI * 2);
              ctx.fill();

              if (zoom >= 7 && value > 0.5) {
                ctx.globalAlpha = 0.9;
                ctx.fillStyle = '#fff';
                ctx.font = `${Math.max(8, 11 - (10 - zoom))}px Inter, sans-serif`;
                ctx.textAlign = 'center';
                ctx.fillText(`${value.toFixed(1)}mm`, pos.x, pos.y + 4);
              }
              break;

            case 'wind':
              value = point.hourly.wind_speed_10m?.[hourIdx];
              if (value == null) continue;
              color = Utils.windColor(value);
              ctx.globalAlpha = 0.6;
              ctx.fillStyle = color;
              ctx.fillRect(pos.x - cellSize / 2, pos.y - cellSize / 2, cellSize, cellSize);

              if (zoom >= 7) {
                ctx.globalAlpha = 0.9;
                ctx.fillStyle = '#fff';
                ctx.font = `${Math.max(8, 11 - (10 - zoom))}px Inter, sans-serif`;
                ctx.textAlign = 'center';
                ctx.fillText(`${Math.round(value)}m/s`, pos.x, pos.y + 4);
              }
              break;

            case 'clouds':
              value = point.hourly.cloud_cover?.[hourIdx];
              if (value == null || value <= 10) continue;
              color = Utils.cloudColor(value);
              ctx.globalAlpha = 0.5;
              ctx.fillStyle = color;
              ctx.fillRect(pos.x - cellSize / 2, pos.y - cellSize / 2, cellSize, cellSize);
              break;
          }
        }
        ctx.globalAlpha = 1;
      });

    this.canvasOverlay = overlay;
    overlay.addTo(map);
  },

  removeOverlay(map) {
    if (this.canvasOverlay) {
      map.removeLayer(this.canvasOverlay);
      this.canvasOverlay = null;
    }
  },

  // Animate weather through time
  startAnimation(map, type) {
    this.stopAnimation();
    let hour = 0;
    this.animationTimer = setInterval(() => {
      hour = (hour + 3) % 168;
      this.createOverlay(map, type, hour);

      // Update timeline slider
      const slider = document.getElementById('weather-timeline-slider');
      const sideSlider = document.getElementById('weather-time-slider');
      if (slider) slider.value = hour;
      if (sideSlider) sideSlider.value = hour;

      Weather.updateTimeLabel(hour);
    }, 500);
  },

  stopAnimation() {
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
  },

  // Update time display
  updateTimeLabel(hourOffset) {
    const now = new Date();
    now.setHours(now.getHours() + hourOffset);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const label = hourOffset === 0 ? 'Now' :
      `${dayNames[now.getDay()]} ${now.getHours().toString().padStart(2, '0')}:00`;

    document.getElementById('weather-time-label').textContent = label;
    document.getElementById('weather-timeline-time').textContent = label;
  },

  // Build weather HTML for info panel
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
    switch (type) {
      case 'temperature':
        return `
          <div class="weather-legend-bar">
            <div style="flex:1;background:#0000ff"></div>
            <div style="flex:1;background:#0066ff"></div>
            <div style="flex:1;background:#00ccff"></div>
            <div style="flex:1;background:#00ff88"></div>
            <div style="flex:1;background:#88ff00"></div>
            <div style="flex:1;background:#ffcc00"></div>
            <div style="flex:1;background:#ff6600"></div>
            <div style="flex:1;background:#ff0000"></div>
          </div>
          <div class="weather-legend-labels"><span>0°C</span><span>10°C</span><span>20°C</span><span>30°C+</span></div>`;

      case 'precipitation':
        return `
          <div class="weather-legend-bar">
            <div style="flex:1;background:rgba(0,150,255,0.3)"></div>
            <div style="flex:1;background:rgba(0,100,255,0.5)"></div>
            <div style="flex:1;background:rgba(0,50,255,0.6)"></div>
            <div style="flex:1;background:rgba(50,0,200,0.7)"></div>
            <div style="flex:1;background:rgba(100,0,150,0.8)"></div>
          </div>
          <div class="weather-legend-labels"><span>0mm</span><span>2mm</span><span>5mm</span><span>10mm+</span></div>`;

      case 'wind':
        return `
          <div class="weather-legend-bar">
            <div style="flex:1;background:rgba(0,200,83,0.4)"></div>
            <div style="flex:1;background:rgba(0,200,83,0.6)"></div>
            <div style="flex:1;background:rgba(255,171,64,0.6)"></div>
            <div style="flex:1;background:rgba(255,82,82,0.6)"></div>
            <div style="flex:1;background:rgba(255,0,0,0.8)"></div>
          </div>
          <div class="weather-legend-labels"><span>0m/s</span><span>5m/s</span><span>10m/s</span><span>15m/s+</span></div>`;

      case 'clouds':
        return `
          <div class="weather-legend-bar">
            <div style="flex:1;background:rgba(180,190,200,0.1)"></div>
            <div style="flex:1;background:rgba(180,190,200,0.3)"></div>
            <div style="flex:1;background:rgba(180,190,200,0.5)"></div>
            <div style="flex:1;background:rgba(180,190,200,0.7)"></div>
          </div>
          <div class="weather-legend-labels"><span>Clear</span><span>25%</span><span>50%</span><span>100%</span></div>`;

      default:
        return '';
    }
  }
};

// Leaflet Canvas Overlay plugin (lightweight)
L.CanvasOverlay = L.Layer.extend({
  _drawing: null,
  _canvas: null,

  drawing(fn) {
    this._drawing = fn;
    return this;
  },

  onAdd(map) {
    this._map = map;
    this._canvas = L.DomUtil.create('canvas', 'leaflet-canvas-overlay');
    const size = map.getSize();
    this._canvas.width = size.x;
    this._canvas.height = size.y;
    this._canvas.style.position = 'absolute';
    this._canvas.style.top = '0';
    this._canvas.style.left = '0';
    this._canvas.style.pointerEvents = 'none';

    map.getPanes().overlayPane.appendChild(this._canvas);
    map.on('moveend', this._redraw, this);
    map.on('resize', this._resize, this);
    this._redraw();
  },

  onRemove(map) {
    map.getPanes().overlayPane.removeChild(this._canvas);
    map.off('moveend', this._redraw, this);
    map.off('resize', this._resize, this);
  },

  _resize(e) {
    const size = this._map.getSize();
    this._canvas.width = size.x;
    this._canvas.height = size.y;
    this._redraw();
  },

  _redraw() {
    const topLeft = this._map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._canvas, topLeft);
    if (this._drawing) {
      this._drawing(this, { canvas: this._canvas, map: this._map });
    }
  }
});

L.canvasOverlay = function () { return new L.CanvasOverlay(); };
