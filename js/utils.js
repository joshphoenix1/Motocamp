/* ===== Utility Functions ===== */
const Utils = {
  // Haversine distance in km
  distance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  toRad(deg) { return deg * Math.PI / 180; },

  // Format distance
  formatDistance(km) {
    return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
  },

  // Format duration in hours
  formatDuration(hours) {
    if (hours < 1) return `${Math.round(hours * 60)}min`;
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  },

  // Debounce
  debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  },

  // Create custom Leaflet divIcon marker
  createMarker(type, icon) {
    return L.divIcon({
      className: `custom-marker marker-${type}`,
      html: `<i class="fas fa-${icon}"></i>`,
      iconSize: type === 'campsite' ? [18, 18] :
                type === 'commercial' ? [16, 16] :
                type === 'fuel' ? [16, 16] :
                type === 'freedom' ? [14, 14] : [14, 14],
      iconAnchor: type === 'campsite' ? [9, 9] :
                  type === 'commercial' ? [8, 8] :
                  type === 'fuel' ? [8, 8] :
                  type === 'freedom' ? [7, 7] : [7, 7],
    });
  },

  createTowerMarker(carrier) {
    const cls = carrier === 'Spark' ? 'spark' : carrier === 'Vodafone' ? 'vodafone' : 'twodeg';
    return L.divIcon({
      className: `custom-marker marker-tower ${cls}`,
      html: '<i class="fas fa-signal"></i>',
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
  },

  // DOC facility types mapping
  facilityMap: {
    'Serviced Campsite': {
      toilets: true, water: true, showers: true, power: true, kitchen: true,
      bbq: true, rubbish: true, tables: true,
      fee: '$15-$25/night', feeLevel: 'paid',
      description: 'Full-service campsite with flush toilets, hot showers, kitchen, and powered sites.'
    },
    'Standard Campsite': {
      toilets: true, water: true, showers: 'cold', power: false, kitchen: false,
      bbq: false, rubbish: true, tables: true,
      fee: '$10-$15/night', feeLevel: 'paid',
      description: 'Toilet facilities, water supply, and basic amenities. Cold showers may be available.'
    },
    'Scenic Campsite': {
      toilets: true, water: true, showers: false, power: false, kitchen: false,
      bbq: false, rubbish: false, tables: true,
      fee: '$8-$15/night', feeLevel: 'paid',
      description: 'Basic facilities in scenic locations. Toilets and water available.'
    },
    'Basic Campsite': {
      toilets: true, water: 'untreated', showers: false, power: false, kitchen: false,
      bbq: false, rubbish: false, tables: false,
      fee: 'Free', feeLevel: 'free',
      description: 'Basic toilet. Water may be from a stream (untreated). Pack in, pack out.'
    },
  },

  // Get facility info for a DOC campsite type
  getFacilities(typeDesc) {
    for (const [key, val] of Object.entries(this.facilityMap)) {
      if (typeDesc && typeDesc.toLowerCase().includes(key.toLowerCase())) return val;
    }
    return this.facilityMap['Basic Campsite'];
  },

  // Weather code to description and icon
  weatherCodeMap: {
    0: { desc: 'Clear sky', icon: '☀️' },
    1: { desc: 'Mainly clear', icon: '🌤️' },
    2: { desc: 'Partly cloudy', icon: '⛅' },
    3: { desc: 'Overcast', icon: '☁️' },
    45: { desc: 'Fog', icon: '🌫️' },
    48: { desc: 'Rime fog', icon: '🌫️' },
    51: { desc: 'Light drizzle', icon: '🌦️' },
    53: { desc: 'Drizzle', icon: '🌦️' },
    55: { desc: 'Heavy drizzle', icon: '🌧️' },
    61: { desc: 'Light rain', icon: '🌧️' },
    63: { desc: 'Rain', icon: '🌧️' },
    65: { desc: 'Heavy rain', icon: '🌧️' },
    71: { desc: 'Light snow', icon: '🌨️' },
    73: { desc: 'Snow', icon: '🌨️' },
    75: { desc: 'Heavy snow', icon: '❄️' },
    80: { desc: 'Rain showers', icon: '🌦️' },
    81: { desc: 'Mod. showers', icon: '🌧️' },
    82: { desc: 'Heavy showers', icon: '⛈️' },
    95: { desc: 'Thunderstorm', icon: '⛈️' },
    96: { desc: 'T-storm + hail', icon: '⛈️' },
    99: { desc: 'T-storm + hail', icon: '⛈️' },
  },

  getWeatherInfo(code) {
    return this.weatherCodeMap[code] || { desc: 'Unknown', icon: '❓' };
  },

  // Temperature color
  tempColor(t) {
    if (t <= 0) return '#0000ff';
    if (t <= 5) return '#0066ff';
    if (t <= 10) return '#00ccff';
    if (t <= 15) return '#00ff88';
    if (t <= 20) return '#88ff00';
    if (t <= 25) return '#ffcc00';
    if (t <= 30) return '#ff6600';
    return '#ff0000';
  },

  // Wind color (m/s)
  windColor(w) {
    if (w <= 2) return 'rgba(0,200,83,0.4)';
    if (w <= 5) return 'rgba(0,200,83,0.6)';
    if (w <= 10) return 'rgba(255,171,64,0.6)';
    if (w <= 15) return 'rgba(255,82,82,0.6)';
    return 'rgba(255,0,0,0.8)';
  },

  // Rain color (mm)
  rainColor(r) {
    if (r <= 0) return 'rgba(0,0,0,0)';
    if (r <= 0.5) return 'rgba(0,150,255,0.3)';
    if (r <= 2) return 'rgba(0,100,255,0.5)';
    if (r <= 5) return 'rgba(0,50,255,0.6)';
    if (r <= 10) return 'rgba(50,0,200,0.7)';
    return 'rgba(100,0,150,0.8)';
  },

  // Cloud color
  cloudColor(c) {
    const a = c / 100 * 0.6;
    return `rgba(180,190,200,${a})`;
  }
};
