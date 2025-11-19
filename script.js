// --- 1. Configuration & Mock Data ---
proj4.defs(
  "EPSG:25830",
  "+proj=utm +zone=30 +ellps=GRS80 +units=m +no_defs"
);

const stations = [
  {
    id: "1001",
    name: "Puerta del Sol",
    lat: 40.416775,
    lon: -3.70379,
    bikes: 8,
    cap: 25,
    trips: 150,
    collisions: 1,
  },
  {
    id: "1012",
    name: "Plaza Mayor",
    lat: 40.415524,
    lon: -3.707412,
    bikes: 5,
    cap: 20,
    trips: 110,
    collisions: 0,
  },
  {
    id: "2030",
    name: "Atocha Renfe",
    lat: 40.406876,
    lon: -3.690486,
    bikes: 18,
    cap: 30,
    trips: 240,
    collisions: 3,
  },
  {
    id: "3120",
    name: "Argüelles",
    lat: 40.432167,
    lon: -3.717857,
    bikes: 3,
    cap: 15,
    trips: 45,
    collisions: 0,
  },
  {
    id: "4120",
    name: "Chamartín",
    lat: 40.472,
    lon: -3.6844,
    bikes: 10,
    cap: 25,
    trips: 80,
    collisions: 1,
  },
  {
    id: "5201",
    name: "Malasaña",
    lat: 40.4259,
    lon: -3.708,
    bikes: 6,
    cap: 15,
    trips: 95,
    collisions: 1,
  },
];

const vehicleLabelMap = {
  bicycle: "Bicicleta",
  "electric bicycle": "Bicicleta eléctrica",
};

function normalizeVehicle(type = "") {
  const key = type.toLowerCase();
  return vehicleLabelMap[key] || type;
}

function formatLocation(localizacion = "", numero = "") {
  if (!numero || numero === "0") return localizacion;
  const trimmed = String(numero).trim();
  if (localizacion.toLowerCase().includes(trimmed.toLowerCase())) {
    return localizacion;
  }
  return `${localizacion}, ${trimmed}`;
}

let accidents = [];

function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  
  return lines.slice(1).map(line => {
      const values = [];
      let current = '';
      let inQuote = false;
      
      for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
              inQuote = !inQuote;
          } else if (char === ',' && !inQuote) {
              values.push(current.trim().replace(/^"|"$/g, ''));
              current = '';
          } else {
              current += char;
          }
      }
      values.push(current.trim().replace(/^"|"$/g, ''));
      
      return headers.reduce((obj, header, index) => {
          obj[header] = values[index];
          return obj;
      }, {});
  });
}

async function loadAccidentData() {
  try {
    const response = await fetch('accidents.csv');
    if (!response.ok) throw new Error('Failed to load CSV');
    const text = await response.text();
    const rawData = parseCSV(text);

    const accidentsRaw = rawData.map((row) => ({
      exp: row.num_expediente,
      date: `${row.fecha}T${row.hora}`,
      loc: formatLocation(row.localizacion, row.numero),
      tipo: row.tipo_accidente,
      lesion: row.lesividad || "Sin dato",
      x: Number(row.coordenada_x_utm),
      y: Number(row.coordenada_y_utm),
      meteo: row.estado_meteorológico,
      distrito: row.distrito,
      vehiculo: normalizeVehicle(row.tipo_vehiculo),
      persona: row.tipo_persona,
      edad: row.rango_edad || "Desconocido",
      sexo: row.sexo || "Desconocido",
      positivaAlcohol: row.positiva_alcohol === 'true',
      positivaDroga: row.positiva_droga === 'true',
    }));

    accidents = accidentsRaw.map((a) => {
      const [lon, lat] = proj4("EPSG:25830", "EPSG:4326", [a.x, a.y]);
      let color = "#22c55e"; // green (safe/minor)
      let weight = 1;
      let severity = "Sin asistencia";

      if (a.lesion.includes("Ingreso")) {
        color = "#ef4444";
        weight = 3;
        severity = "Ingreso 24h";
      } else if (a.lesion.includes("Asistencia")) {
        color = "#eab308";
        weight = 1.5;
        severity = "Asistencia";
      }

      return { ...a, lat, lon, color, heatWeight: weight, severity };
    });

    renderAccidents();
    updateStats();

  } catch (err) {
    console.error("Error loading accident data:", err);
    alert("Error loading accident data. Please ensure you are running this on a local server.");
  }
}

// --- 2. Map Initialization ---

const map = L.map("map", { zoomControl: false }).setView(
  [40.4168, -3.7038],
  13
);
L.control.zoom({ position: "topright" }).addTo(map);

// Tile Layers (CartoDB for better look)
const lightTiles = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  {
    attribution: "© OpenStreetMap, © CartoDB",
  }
);
const darkTiles = L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  {
    attribution: "© OpenStreetMap, © CartoDB",
  }
);

lightTiles.addTo(map); // Default

// Layer Groups
const layers = {
  stations: L.layerGroup().addTo(map),
  accidents: L.layerGroup().addTo(map),
  heat: L.layerGroup(), // Not added by default
  routes: L.layerGroup().addTo(map),
};

const filterState = {
  weather: "all",
  age: "all",
};

// --- 3. Logic Functions ---

// Safety Score: 0 to 1 (1 is safest)
function getSafetyScore(s) {
  const utilization = s.trips / 300; // Normalize trips
  const danger = Math.min(s.collisions, 5) / 5;
  let score = 0.4 * (1 - danger) + 0.6 * (s.bikes / s.cap);
  return Math.max(0.1, Math.min(1, score));
}

function getScoreColor(score) {
  if (score >= 0.7) return "#22c55e";
  if (score >= 0.4) return "#eab308";
  return "#ef4444";
}

function updateStats() {
  document.getElementById("stat-stations").innerText = stations.length;
  document.getElementById("stat-accidents").innerText = accidents.length;
}

// Render Stations
function renderStations() {
  layers.stations.clearLayers();
  const listEl = document.getElementById("station-list");
  listEl.innerHTML = "";

  stations.forEach((s) => {
    const score = getSafetyScore(s);
    const color = getScoreColor(score);

    // Map Marker (Circle size based on capacity)
    const radius = 4 + s.cap / 4;
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: radius,
      fillColor: "#3b82f6",
      color: "#1d4ed8",
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9,
    }).addTo(layers.stations);

    const popupContent = `
    <div style="font-family:Inter; font-size:13px;">
      <strong style="font-size:14px">${s.name}</strong><br>
      <div style="margin-top:4px; display:flex; gap:8px; color:#666;">
        <span>🚲 ${s.bikes}/${s.cap}</span>
        <span>⚠️ ${s.collisions} incidents</span>
      </div>
      <div style="margin-top:6px; font-weight:600; color:${color}">
        Safety Score: ${(score * 100).toFixed(0)}%
      </div>
    </div>
  `;
    marker.bindPopup(popupContent);

    // Sidebar Item
    const item = document.createElement("div");
    item.className = "stat-card";
    item.innerHTML = `
    <div class="stat-header">
      <span>${s.name}</span>
      <span class="score-badge" style="background:${color}">${(
      score * 100
    ).toFixed(0)}</span>
    </div>
    <div class="stat-row">
      <span>Avail: ${s.bikes}/${s.cap}</span>
      <span>Trips: ${s.trips}</span>
    </div>
  `;
    item.addEventListener("click", () => {
      map.flyTo([s.lat, s.lon], 15);
      marker.openPopup();
    });
    listEl.appendChild(item);
  });
}

// Render Accidents based on filter with detailed popup
function renderAccidents() {
  layers.accidents.clearLayers();

  const filtered = accidents.filter((a) => {
    const weatherMatches =
      filterState.weather === "all"
        ? true
        : a.meteo
            .toLowerCase()
            .includes(filterState.weather.toLowerCase());
    const ageMatches =
      filterState.age === "all" ? true : a.edad === filterState.age;
    return weatherMatches && ageMatches;
  });

  filtered.forEach((a) => {
    const marker = L.circleMarker([a.lat, a.lon], {
      radius: 6,
      fillColor: a.color,
      color: "#fff",
      weight: 1,
      fillOpacity: 0.7,
    }).addTo(layers.accidents);

    // Format date
    const dateObj = new Date(a.date);
    const formattedDate = dateObj
      .toLocaleString("es-ES", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
      .replace(",", "");

    // Create detailed popup content matching the image
    const shouldShowDetails = a.severity !== "Sin asistencia";
    if (!shouldShowDetails) {
      return;
    }

    const popupContent = `
    <div class="accident-popup">
      <h3>Accidente ${a.exp}</h3>
      <div class="accident-detail">
        <strong>Fecha:</strong>
        <span>${formattedDate}</span>
      </div>
      <div class="accident-detail">
        <strong>Ubicación:</strong>
        <span>${a.loc}</span>
      </div>
      <div class="accident-detail">
        <strong>Tipo:</strong>
        <span>${a.tipo}</span>
      </div>
      <div class="accident-detail">
        <strong>Distrito:</strong>
        <span>${a.distrito}</span>
      </div>
      <div class="accident-detail">
        <strong>Vehículo:</strong>
        <span>${a.vehiculo}</span>
      </div>
      <div class="accident-detail">
        <strong>Persona:</strong>
        <span>${a.persona} (${a.edad})</span>
      </div>
      <div class="accident-detail">
        <strong>Meteo:</strong>
        <span>${a.meteo}</span>
      </div>
      <div class="accident-detail">
        <strong>Lesividad:</strong>
        <span>${a.lesion}</span>
      </div>
    </div>
  `;

    marker.bindPopup(popupContent, {
      maxWidth: 350,
      className: "custom-accident-popup",
    });

    marker.on("mouseover", () => {
      marker.openPopup();
    });

    marker.on("mouseout", () => {
      marker.closePopup();
    });
  });
}

// Heatmap Logic
function toggleHeatmap(type) {
  layers.heat.clearLayers();
  if (map.hasLayer(layers.heat)) map.removeLayer(layers.heat);

  let points = [];
  let config = { radius: 25, blur: 15, maxZoom: 16 };

  if (type === "trips") {
    points = stations.map((s) => [s.lat, s.lon, s.trips / 50]); // scale intensity
    config.radius = 40;
    document.getElementById("legend").innerText =
      "Heatmap: High density of bicycle trips";
  } else if (type === "collisions") {
    // Use accident data for collision heat, not just station data
    points = accidents.map((a) => [a.lat, a.lon, a.heatWeight]);
    config.radius = 30;
    document.getElementById("legend").innerText =
      "Heatmap: Accident concentration zones";
  }

  L.heatLayer(points, config).addTo(layers.heat);
  map.addLayer(layers.heat);
}

// Routing Logic
function drawRoute(startId, endId, isScenic = false) {
  layers.routes.clearLayers();
  layers.heat.clearLayers(); // Clear noise

  const s = stations.find((st) => st.id === startId);
  const e = stations.find((st) => st.id === endId);
  if (!s || !e) return;

  let latlngs = [];
  let color = isScenic ? "#22c55e" : "#3b82f6"; // Green for scenic, Blue for direct
  let dashArray = isScenic ? "10, 10" : null;

  if (isScenic) {
    // Mock waypoint (Malasaña)
    const waypoint = stations.find((st) => st.id === "5201");
    latlngs = [
      [s.lat, s.lon],
      [waypoint.lat, waypoint.lon],
      [e.lat, e.lon],
    ];
    document.getElementById(
      "legend"
    ).innerHTML = `<b>Scenic Route:</b> ${s.name} → ${waypoint.name} → ${e.name}<br>Distance: ~2.8 km`;
  } else {
    latlngs = [
      [s.lat, s.lon],
      [e.lat, e.lon],
    ];
    // Calculate straight line dist roughly
    const dist = map.distance([s.lat, s.lon], [e.lat, e.lon]) / 1000;
    document.getElementById("legend").innerHTML = `<b>Direct Route:</b> ${
      s.name
    } → ${e.name}<br>Distance: ~${dist.toFixed(2)} km (Linear)`;
  }

  const poly = L.polyline(latlngs, {
    color,
    weight: 5,
    opacity: 0.8,
    dashArray,
  }).addTo(layers.routes);
  map.fitBounds(poly.getBounds(), { padding: [50, 50] });

  // Add Start/End markers on top of route
  L.marker([s.lat, s.lon])
    .addTo(layers.routes)
    .bindPopup("Start: " + s.name);
  L.marker([e.lat, e.lon])
    .addTo(layers.routes)
    .bindPopup("End: " + e.name);
}

function highlightSafeSpots() {
  layers.routes.clearLayers();
  const safeStations = stations
    .map((s) => ({ ...s, score: getSafetyScore(s) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3); // Top 3

  safeStations.forEach((s) => {
    L.circleMarker([s.lat, s.lon], {
      radius: 20,
      color: "#22c55e",
      fill: false,
      weight: 3,
      }).addTo(layers.routes); // Add ring effect
  });

  document.getElementById("legend").innerText =
    "Highlighted: Top 3 safest stations based on availability and incident history.";
  map.setView([40.42, -3.7], 13);
}

// --- 4. Event Listeners ---

// Theme Toggle
document
  .getElementById("themeToggle")
  .addEventListener("click", function () {
    const isDark = document.body.classList.toggle("dark");
    this.textContent = isDark ? "☀️ Light Mode" : "🌙 Dark Mode";

    if (isDark) {
      map.removeLayer(lightTiles);
      darkTiles.addTo(map);
    } else {
      map.removeLayer(darkTiles);
      lightTiles.addTo(map);
    }
  });

// Heatmap Buttons
document
  .getElementById("btn-heat-trips")
  .addEventListener("click", () => toggleHeatmap("trips"));
document
  .getElementById("btn-heat-coll")
  .addEventListener("click", () => toggleHeatmap("collisions"));
document
  .getElementById("btn-safe-spots")
  .addEventListener("click", highlightSafeSpots);

document.getElementById("btn-reset-map").addEventListener("click", () => {
  layers.heat.clearLayers();
  map.removeLayer(layers.heat);
  layers.routes.clearLayers();
  map.setView([40.4168, -3.7038], 13);
  document.getElementById("legend").innerText = "Map reset.";
});

// Routes
document
  .getElementById("route-sol-plaza")
  .addEventListener("click", () => drawRoute("1001", "1012", false));
document
  .getElementById("route-sol-plaza-scenic")
  .addEventListener("click", () => drawRoute("1001", "1012", true));
document
  .getElementById("route-sol-atocha")
  .addEventListener("click", () => drawRoute("1001", "2030", false));

// Weather Filter
document
  .getElementById("weatherFilter")
  .addEventListener("change", (e) => {
    filterState.weather = e.target.value;
    renderAccidents();
  });

document.getElementById("ageFilter").addEventListener("change", (e) => {
  filterState.age = e.target.value;
  renderAccidents();
});

// --- 5. Init ---
renderStations();
loadAccidentData();
// renderAccidents and updateStats are called after data load
