/* ===== Health Check & Auto-Recovery ===== */
const HealthCheck = {
  interval: null,
  CHECK_INTERVAL: 30000, // 30 seconds
  failCounts: {},
  log: [],
  maxLog: 50,

  start(map) {
    this.map = map;
    this.interval = setInterval(() => this.runChecks(), this.CHECK_INTERVAL);
    // Run first check after data has had time to load
    setTimeout(() => this.runChecks(), 10000);
    console.log('[HealthCheck] Started — checking every 30s');
  },

  addLog(level, msg) {
    const entry = { time: new Date().toISOString(), level, msg };
    this.log.push(entry);
    if (this.log.length > this.maxLog) this.log.shift();
    console[level === 'fix' ? 'warn' : level === 'error' ? 'error' : 'log'](`[HealthCheck] ${msg}`);
  },

  incrementFail(key) {
    this.failCounts[key] = (this.failCounts[key] || 0) + 1;
    return this.failCounts[key];
  },

  clearFail(key) {
    this.failCounts[key] = 0;
  },

  runChecks() {
    try {
      this.checkMap();
      this.checkDataLoaded();
      this.checkLayerGroups();
      this.checkToggleSync();
      this.checkWeatherOverlay();
      this.checkWindCanvas();
      this.checkInfoPanel();
      this.checkDOMIntegrity();
      this.checkMemory();
    } catch (e) {
      this.addLog('error', `Health check loop error: ${e.message}`);
    }
  },

  // 1. Map tile layer present and rendering
  checkMap() {
    if (!this.map) return;

    let hasBasemap = false;
    this.map.eachLayer(layer => {
      if (layer instanceof L.TileLayer && !layer.options?.attribution?.includes('OpenWeatherMap')) {
        hasBasemap = true;
      }
    });

    if (!hasBasemap) {
      this.addLog('fix', 'No base tile layer found — restoring streets basemap');
      const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
      });
      this.map.addLayer(streets);
      streets.bringToBack();
      // Re-activate the streets button
      document.querySelectorAll('.basemap-btn').forEach(b => b.classList.remove('active'));
      const streetsBtn = document.querySelector('[data-basemap="streets"]');
      if (streetsBtn) streetsBtn.classList.add('active');
    }

    // Check map container has valid size
    const container = this.map.getContainer();
    if (container.offsetWidth === 0 || container.offsetHeight === 0) {
      this.addLog('fix', 'Map container has zero size — invalidating');
      this.map.invalidateSize();
    }
  },

  // 2. Data loaded successfully
  checkDataLoaded() {
    const cache = DataLoader.cache;
    if (!cache || Object.keys(cache).length === 0) {
      const count = this.incrementFail('data');
      if (count === 3) {
        this.addLog('fix', 'Data not loaded after 3 checks — retrying load');
        DataLoader.loadAll().then(data => {
          if (data && Object.keys(data).length > 0) {
            this.addLog('fix', 'Data reload successful — reinitializing layers');
            Layers.init(this.map, data);
            this.clearFail('data');
          }
        }).catch(e => {
          this.addLog('error', `Data reload failed: ${e.message}`);
        });
      }
      return;
    }

    // Check individual data sources
    const sources = ['docCampsites', 'osmCampsites', 'osmAmenities'];
    for (const src of sources) {
      if (!cache[src] || !cache[src].features || cache[src].features.length === 0) {
        const count = this.incrementFail(`data-${src}`);
        if (count === 3) {
          this.addLog('fix', `${src} has no features — attempting reload`);
          const loaderMap = {
            docCampsites: () => DataLoader.loadDOCCampsites(),
            osmCampsites: () => DataLoader.loadOSMCampsites(),
            osmAmenities: () => DataLoader.loadOSMAmenities(),
          };
          if (loaderMap[src]) {
            loaderMap[src]().then(data => {
              if (data?.features?.length > 0) {
                DataLoader.cache[src] = data;
                this.addLog('fix', `${src} reloaded (${data.features.length} features)`);
                this.clearFail(`data-${src}`);
              }
            }).catch(() => {});
          }
        }
      } else {
        this.clearFail(`data-${src}`);
      }
    }
  },

  // 3. Layer groups exist and have markers
  checkLayerGroups() {
    if (!Layers.groups || Object.keys(Layers.groups).length === 0) return;

    const expected = ['doc-campsites', 'commercial-camps', 'freedom-camps'];
    for (const key of expected) {
      const group = Layers.groups[key];
      if (!group) {
        this.addLog('fix', `Layer group "${key}" missing — will recover on next data load`);
        continue;
      }
    }
  },

  // 4. Toggle checkboxes in sync with actual layer state
  checkToggleSync() {
    document.querySelectorAll('[data-layer]').forEach(checkbox => {
      const layerKey = checkbox.dataset.layer;
      const group = Layers.groups?.[layerKey];
      if (!group || !this.map) return;

      const isOnMap = this.map.hasLayer(group);
      const isChecked = checkbox.checked;

      if (isChecked && !isOnMap) {
        this.addLog('fix', `Toggle "${layerKey}" checked but layer missing from map — re-adding`);
        this.map.addLayer(group);
      } else if (!isChecked && isOnMap) {
        this.addLog('fix', `Toggle "${layerKey}" unchecked but layer on map — removing`);
        this.map.removeLayer(group);
      }
    });
  },

  // 5. Weather overlay consistency
  checkWeatherOverlay() {
    if (!Weather.activeType) return;

    // Check OWM tile layer is still on the map
    if (Weather.activeTileLayer && this.map && !this.map.hasLayer(Weather.activeTileLayer)) {
      this.addLog('fix', 'Weather tile layer detached from map — re-adding');
      this.map.addLayer(Weather.activeTileLayer);
    }

    // Check weather checkbox is still checked
    const activeCheckbox = document.querySelector(`[data-weather="${Weather.activeType}"]`);
    if (activeCheckbox && !activeCheckbox.checked) {
      this.addLog('fix', 'Weather active but checkbox unchecked — cleaning up overlay');
      Weather.removeOverlay();
      document.getElementById('weather-timeline')?.classList.add('hidden');
      document.getElementById('weather-legend')?.classList.add('hidden');
    }
  },

  // 6. Wind canvas size in sync with map
  checkWindCanvas() {
    if (!Weather.windCanvas || !Weather.activeType || Weather.activeType !== 'wind') return;

    const mapSize = this.map?.getSize();
    if (!mapSize) return;

    if (Weather.windCanvas.width !== mapSize.x || Weather.windCanvas.height !== mapSize.y) {
      this.addLog('fix', 'Wind canvas size mismatch — resizing');
      Weather.resizeCanvas();
      Weather.resetParticles();
    }

    // Check wind animation is running
    if (!Weather.windAnimFrame && Weather.windGrid) {
      this.addLog('fix', 'Wind animation stopped — restarting');
      Weather.startWindAnimation();
    }
  },

  // 7. Info panel not stuck open
  checkInfoPanel() {
    const panel = document.getElementById('info-panel');
    if (!panel || panel.classList.contains('hidden')) return;

    const content = document.getElementById('info-content');
    if (content && content.innerHTML.trim() === '') {
      this.addLog('fix', 'Info panel open but empty — closing');
      panel.classList.add('hidden');
    }
  },

  // 8. Critical DOM elements exist
  checkDOMIntegrity() {
    const critical = ['map', 'sidebar', 'info-panel', 'search-input'];
    for (const id of critical) {
      if (!document.getElementById(id)) {
        this.addLog('error', `Critical DOM element #${id} missing — page may need refresh`);
      }
    }

    // Loading screen should be gone after 30s
    const loading = document.getElementById('loading-screen');
    if (loading && loading.style.display !== 'none') {
      this.addLog('fix', 'Loading screen still visible — hiding');
      loading.classList.add('fade-out');
      setTimeout(() => loading.style.display = 'none', 500);
    }
  },

  // 9. Memory / leak detection
  checkMemory() {
    if (!performance.memory) return; // Chrome only

    const used = performance.memory.usedJSHeapSize;
    const limit = performance.memory.jsHeapSizeLimit;
    const pct = (used / limit * 100).toFixed(1);

    if (used > limit * 0.85) {
      this.addLog('error', `High memory usage: ${pct}% (${(used / 1048576).toFixed(0)}MB) — clearing caches`);

      // Clear weather point cache if any
      if (Weather.windGrid && !Weather.activeType) {
        Weather.windGrid = null;
        Weather.gridData = null;
        this.addLog('fix', 'Cleared inactive wind grid data');
      }
    }
  },

  // Get health status summary
  getStatus() {
    const issues = this.log.filter(e => e.level === 'fix' || e.level === 'error');
    const recent = issues.filter(e => Date.now() - new Date(e.time).getTime() < 300000);
    return {
      healthy: recent.length === 0,
      recentFixes: recent.length,
      totalFixes: issues.length,
      log: this.log.slice(-10)
    };
  }
};
