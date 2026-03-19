/* ===== NZ Gravel Roads Database ===== */
/* Key gravel/unsealed roads in New Zealand that are vehicle-accessible */
const GravelRoads = {
  // Each road: array of waypoints along the route
  // These are intermediate points that force routing onto gravel roads
  roads: [
    // North Island
    { name: 'Forgotten World Highway (SH43)', region: 'north',
      points: [[-38.955, 174.555], [-38.98, 174.72], [-39.05, 174.82], [-39.12, 174.88], [-39.28, 174.97]] },
    { name: 'Gentle Annie Road', region: 'north',
      points: [[-39.45, 176.10], [-39.50, 175.95], [-39.55, 175.80], [-39.58, 175.70]] },
    { name: 'Moerangi Track Road', region: 'north',
      points: [[-38.75, 175.85], [-38.82, 175.92]] },
    { name: 'Parapara Peak Road', region: 'north',
      points: [[-40.85, 172.65], [-40.88, 172.58]] },
    { name: 'Whangamomona Road', region: 'north',
      points: [[-39.00, 174.60], [-39.05, 174.75]] },
    { name: 'East Cape Road (SH35 inland)', region: 'north',
      points: [[-38.40, 177.40], [-38.20, 177.60], [-38.05, 177.80], [-37.80, 178.00]] },
    { name: 'Tarata Road', region: 'north',
      points: [[-39.10, 174.25], [-39.05, 174.40]] },
    { name: 'Pohokura Road', region: 'north',
      points: [[-39.20, 176.55], [-39.25, 176.45]] },

    // South Island — West Coast & Passes
    { name: 'Makarora-Mt Aspiring Road', region: 'south',
      points: [[-44.25, 169.20], [-44.30, 169.15], [-44.35, 169.10]] },
    { name: 'Skippers Canyon Road', region: 'south',
      points: [[-44.88, 168.70], [-44.85, 168.65], [-44.82, 168.60]] },
    { name: 'Moke Lake Road', region: 'south',
      points: [[-45.02, 168.58], [-45.00, 168.55]] },
    { name: 'Cardrona Valley Road', region: 'south',
      points: [[-44.85, 168.95], [-44.80, 169.00], [-44.75, 169.05]] },
    { name: 'Crown Range Back Roads', region: 'south',
      points: [[-44.92, 168.90], [-44.88, 168.95]] },
    { name: 'Nevis Road', region: 'south',
      points: [[-45.10, 168.85], [-45.08, 168.95], [-45.05, 169.10], [-45.03, 169.20]] },
    { name: 'Danseys Pass', region: 'south',
      points: [[-44.90, 170.50], [-44.88, 170.40], [-44.85, 170.30], [-44.82, 170.20]] },
    { name: 'Hakataramea Pass Road', region: 'south',
      points: [[-44.55, 170.55], [-44.50, 170.45], [-44.45, 170.35]] },
    { name: 'Molesworth Station Road', region: 'south',
      points: [[-42.10, 173.20], [-42.00, 173.00], [-41.90, 172.80], [-41.85, 172.60]] },
    { name: 'Rainbow Road', region: 'south',
      points: [[-41.85, 172.80], [-41.88, 172.70], [-41.90, 172.55], [-41.95, 172.40]] },
    { name: 'Acheron Road', region: 'south',
      points: [[-42.20, 173.10], [-42.15, 173.00], [-42.05, 172.85]] },
    { name: 'Banks Peninsula Summit Road', region: 'south',
      points: [[-43.72, 172.80], [-43.75, 172.85], [-43.78, 172.90]] },
    { name: 'Lees Valley Road', region: 'south',
      points: [[-43.15, 172.10], [-43.10, 172.05], [-43.05, 172.00]] },
    { name: 'Inland Kaikoura Road', region: 'south',
      points: [[-42.40, 173.60], [-42.35, 173.50], [-42.30, 173.40]] },
    { name: 'Waiau-Toa/Clarence Valley', region: 'south',
      points: [[-42.15, 173.70], [-42.20, 173.60], [-42.25, 173.50]] },
    { name: 'Mavora Lakes Road', region: 'south',
      points: [[-45.30, 168.20], [-45.28, 168.15], [-45.25, 168.10]] },
    { name: 'Von Road (Lake Wakatipu)', region: 'south',
      points: [[-45.20, 168.40], [-45.18, 168.35]] },
    { name: 'Pigroot (SH85)', region: 'south',
      points: [[-45.20, 170.10], [-45.15, 170.00], [-45.10, 169.90]] },
    { name: 'Old Dunstan Road', region: 'south',
      points: [[-45.25, 169.50], [-45.28, 169.40], [-45.30, 169.30]] },
    { name: 'Lindis Pass Back Roads', region: 'south',
      points: [[-44.60, 169.60], [-44.55, 169.55]] },
  ],

  // Find gravel roads near a route corridor
  findNearbyGravelRoads(startLat, startLon, endLat, endLon, maxDistKm) {
    maxDistKm = maxDistKm || 60;
    const results = [];

    // Route corridor: midpoint and bearing
    const midLat = (startLat + endLat) / 2;
    const midLon = (startLon + endLon) / 2;
    const routeLen = this._dist(startLat, startLon, endLat, endLon);

    for (const road of this.roads) {
      // Check if any point on this road is near the route corridor
      let minDist = Infinity;
      let bestPoint = null;

      for (const [lat, lon] of road.points) {
        // Distance from this gravel point to the route line
        const distToStart = this._dist(lat, lon, startLat, startLon);
        const distToEnd = this._dist(lat, lon, endLat, endLon);
        const distToMid = this._dist(lat, lon, midLat, midLon);

        // Must be roughly between start and end (not way off to the side)
        if (distToStart + distToEnd < routeLen * 2.5) {
          const corridorDist = Math.min(distToStart, distToEnd, distToMid);
          if (corridorDist < minDist) {
            minDist = corridorDist;
            bestPoint = [lat, lon];
          }
        }
      }

      if (minDist < maxDistKm && bestPoint) {
        results.push({
          name: road.name,
          points: road.points,
          distance: minDist,
          bestPoint
        });
      }
    }

    // Sort by distance to corridor
    results.sort((a, b) => a.distance - b.distance);
    return results;
  },

  // Get waypoints to inject for gravel routing
  getGravelWaypoints(startLat, startLon, endLat, endLon) {
    const nearby = this.findNearbyGravelRoads(startLat, startLon, endLat, endLon, 80);
    if (nearby.length === 0) return [];

    // Pick up to 3 gravel roads, inject their midpoints as waypoints
    const waypoints = [];
    const used = Math.min(nearby.length, 3);

    for (let i = 0; i < used; i++) {
      const road = nearby[i];
      const pts = road.points;
      // Use the middle point of the gravel road
      const mid = pts[Math.floor(pts.length / 2)];
      waypoints.push({ lat: mid[0], lon: mid[1], name: road.name });
    }

    // Sort waypoints by distance from start (so route flows correctly)
    waypoints.sort((a, b) => {
      const da = this._dist(a.lat, a.lon, startLat, startLon);
      const db = this._dist(b.lat, b.lon, startLat, startLon);
      return da - db;
    });

    return waypoints;
  },

  _dist(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
};
