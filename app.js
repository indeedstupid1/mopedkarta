const VEHICLES = {
  class1: {
    id: "class1",
    label: "Moped klass 1",
    defaultCruise: 45,
    allowCycleways: false,
  },
  class2: {
    id: "class2",
    label: "Moped klass 2",
    defaultCruise: 25,
    allowCycleways: true,
  },
  atraktor: {
    id: "atraktor",
    label: "A-traktor / EPA",
    defaultCruise: 30,
    allowCycleways: false,
  },
};

const MAP_STYLES = {
  street: {
    id: "street",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  satellite: {
    id: "satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    options: {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri",
    },
  },
};

const ROAD_BASE = new Set([
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
  "service",
  "living_street",
  "road",
]);

const CLASS2_EXTRA = new Set(["cycleway", "path"]);
const BLOCKED_ACCESS = new Set(["no", "private"]);
const geocodeCache = new Map();
const networkCache = new Map();

const state = {
  map: null,
  baseLayers: {},
  mapStyle: "street",
  panelOpen: true,
  startMode: "current",
  vehicle: "class1",
  startPoint: null,
  endPoint: null,
  currentLocation: null,
  route: null,
  speedTouched: false,
  markers: {
    start: null,
    end: null,
    current: null,
  },
  layers: {
    route: null,
  },
  navWatchId: null,
  pickingMode: null,
  geocodeControllers: {},
  lastRouteRequestId: 0,
};

const els = {
  controlPanel: document.getElementById("control-panel"),
  panelToggle: document.getElementById("panel-toggle"),
  panelToggleIcon: document.getElementById("panel-toggle-icon"),
  panelBackdrop: document.getElementById("panel-backdrop"),
  styleToggle: document.getElementById("style-toggle"),
  vehicleToggle: document.getElementById("vehicle-toggle"),
  startMode: document.getElementById("start-mode"),
  manualStartWrap: document.getElementById("manual-start-wrap"),
  startInput: document.getElementById("start-input"),
  endInput: document.getElementById("end-input"),
  startSuggestions: document.getElementById("start-suggestions"),
  endSuggestions: document.getElementById("end-suggestions"),
  routeButton: document.getElementById("route-button"),
  swapButton: document.getElementById("swap-button"),
  clearButton: document.getElementById("clear-button"),
  startNavigation: document.getElementById("start-navigation"),
  speedSlider: document.getElementById("speed-slider"),
  speedNumber: document.getElementById("speed-number"),
  speedReadout: document.getElementById("speed-readout"),
  distanceOutput: document.getElementById("distance-output"),
  etaOutput: document.getElementById("eta-output"),
  routeTypeOutput: document.getElementById("route-type-output"),
  summaryNote: document.getElementById("summary-note"),
  directionsList: document.getElementById("directions-list"),
  statusText: document.getElementById("status-text"),
  navTitle: document.getElementById("nav-title"),
  navBody: document.getElementById("nav-body"),
  pickStart: document.getElementById("pick-start"),
  pickEnd: document.getElementById("pick-end"),
};

init();

function init() {
  initMap();
  bindUI();
  applyVehicleState(VEHICLES[state.vehicle]);
  setMapStyle(state.mapStyle);
  updateStartMode();
  updateSpeedUI();
  syncPanelState();
  bootstrapLocation();
}

function initMap() {
  state.map = L.map("map", {
    zoomControl: false,
    preferCanvas: true,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
  }).setView([59.3293, 18.0686], 12.5);

  L.control.zoom({ position: "bottomleft" }).addTo(state.map);

  Object.values(MAP_STYLES).forEach((style) => {
    state.baseLayers[style.id] = L.tileLayer(style.url, {
      crossOrigin: true,
      ...style.options,
    });
  });

  state.map.on("click", handleMapClick);
}

function bindUI() {
  els.panelToggle.addEventListener("click", togglePanel);
  els.panelBackdrop.addEventListener("click", () => setPanelOpen(false));

  els.vehicleToggle.addEventListener("click", (event) => {
    const button = event.target.closest("[data-vehicle]");
    if (!button) {
      return;
    }
    setVehicle(button.dataset.vehicle);
  });

  els.styleToggle.addEventListener("click", (event) => {
    const button = event.target.closest("[data-style]");
    if (!button) {
      return;
    }
    setMapStyle(button.dataset.style);
  });

  els.startMode.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button || button.dataset.mode === state.startMode) {
      return;
    }
    state.startMode = button.dataset.mode;
    updateStartMode();
  });

  els.speedSlider.addEventListener("input", () => {
    state.speedTouched = true;
    updateSpeedUI("slider");
    queueRouteRefresh();
  });

  els.speedNumber.addEventListener("input", () => {
    state.speedTouched = true;
    updateSpeedUI("number");
    queueRouteRefresh();
  });

  els.routeButton.addEventListener("click", buildRoute);
  els.startNavigation.addEventListener("click", startNavigationMode);
  els.swapButton.addEventListener("click", swapLocations);
  els.clearButton.addEventListener("click", clearRouteAndInputs);
  els.pickStart.addEventListener("click", () => toggleMapPicker("start"));
  els.pickEnd.addEventListener("click", () => toggleMapPicker("end"));

  bindAutocomplete(els.startInput, els.startSuggestions, "start");
  bindAutocomplete(els.endInput, els.endSuggestions, "end");

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".field-group")) {
      closeSuggestions("start");
      closeSuggestions("end");
    }
  });

  window.addEventListener("resize", syncPanelState);
}

function togglePanel() {
  setPanelOpen(!state.panelOpen);
}

function setPanelOpen(nextValue) {
  state.panelOpen = nextValue;
  syncPanelState();
}

function syncPanelState() {
  const desktop = window.innerWidth >= 980;
  els.controlPanel.classList.toggle("is-collapsed", !desktop && !state.panelOpen);
  els.panelBackdrop.classList.toggle("is-hidden", desktop || !state.panelOpen);
  els.panelToggleIcon.textContent = !desktop && !state.panelOpen ? "‹" : "›";
}

function queueRouteRefresh() {
  if (!state.route) {
    return;
  }
  window.clearTimeout(buildRoute._timer);
  buildRoute._timer = window.setTimeout(buildRoute, 260);
}

function setMapStyle(styleId) {
  if (!MAP_STYLES[styleId]) {
    return;
  }

  Object.values(state.baseLayers).forEach((layer) => {
    if (state.map.hasLayer(layer)) {
      state.map.removeLayer(layer);
    }
  });

  state.baseLayers[styleId].addTo(state.map);
  state.mapStyle = styleId;

  [...els.styleToggle.querySelectorAll("[data-style]")].forEach((button) => {
    button.classList.toggle("is-active", button.dataset.style === styleId);
  });
}

function bootstrapLocation() {
  if (!navigator.geolocation) {
    state.startMode = "manual";
    updateStartMode();
    setStatus("Plats går inte att läsa här. Skriv startadress i stället.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const point = toPoint(position.coords.latitude, position.coords.longitude, {
        label: "Nuvarande plats",
        source: "current",
      });
      state.currentLocation = point;
      updateMarker("current", point, "current");
      if (state.startMode === "current") {
        state.startPoint = point;
        updateMarker("start", point, "start");
      }
      state.map.flyTo([point.lat, point.lon], 17.25, { duration: 1.15 });
      setStatus("Plats hittad.");
    },
    () => {
      state.startMode = "manual";
      updateStartMode();
      setStatus("Kunde inte hämta din plats. Skriv startadress i stället.");
    },
    {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 30000,
    }
  );
}

function setVehicle(vehicleId) {
  if (!VEHICLES[vehicleId]) {
    return;
  }
  state.vehicle = vehicleId;
  applyVehicleState(VEHICLES[vehicleId]);
  if (state.route) {
    buildRoute();
  }
}

function applyVehicleState(vehicle) {
  [...els.vehicleToggle.querySelectorAll("[data-vehicle]")].forEach((button) => {
    button.classList.toggle("is-active", button.dataset.vehicle === vehicle.id);
  });

  if (!state.speedTouched) {
    els.speedSlider.value = String(vehicle.defaultCruise);
    els.speedNumber.value = String(vehicle.defaultCruise);
  }

  updateSpeedUI();
}

function updateStartMode() {
  const usingCurrent = state.startMode === "current";

  [...els.startMode.querySelectorAll("[data-mode]")].forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === state.startMode);
  });

  els.manualStartWrap.classList.toggle("is-open", !usingCurrent);
  els.startInput.disabled = usingCurrent;
  els.pickStart.disabled = usingCurrent;

  if (usingCurrent) {
    els.startInput.value = "";
    if (state.currentLocation) {
      state.startPoint = state.currentLocation;
      updateMarker("start", state.currentLocation, "start");
      state.map.flyTo([state.currentLocation.lat, state.currentLocation.lon], 17.25, {
        duration: 0.85,
      });
    }
  } else if (!state.startPoint || state.startPoint.source === "current") {
    state.startPoint = null;
    removeMarker("start");
  }
}

function updateSpeedUI(source) {
  const nextValue = clampSpeed(
    Number(source === "number" ? els.speedNumber.value : els.speedSlider.value)
  );
  els.speedSlider.value = String(nextValue);
  els.speedNumber.value = String(nextValue);
  els.speedReadout.textContent = `${nextValue} km/h`;
}

function bindAutocomplete(input, container, kind) {
  let debounceTimer = null;

  input.addEventListener("input", () => {
    if (kind === "start" && state.startMode === "current") {
      return;
    }

    if (kind === "start") {
      state.startPoint = null;
    } else {
      state.endPoint = null;
    }

    window.clearTimeout(debounceTimer);
    const value = input.value.trim();
    if (value.length < 3) {
      closeSuggestions(kind);
      return;
    }

    debounceTimer = window.setTimeout(async () => {
      const results = await fetchGeocodeSuggestions(value, kind, 5);
      renderSuggestions(container, results, kind);
    }, 220);
  });

  input.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    await resolveTypedAddress(kind);
  });
}

async function fetchGeocodeSuggestions(query, kind, limit = 5) {
  const cacheKey = `${limit}:${query.toLowerCase()}`;
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey);
  }

  if (state.geocodeControllers[kind]) {
    state.geocodeControllers[kind].abort();
  }

  const controller = new AbortController();
  state.geocodeControllers[kind] = controller;

  const primary = await requestGeocode(query, limit, controller.signal, true);
  const results = primary.length ? primary : await requestGeocode(query, limit, controller.signal, false);
  geocodeCache.set(cacheKey, results);
  return results;
}

async function requestGeocode(query, limit, signal, swedenOnly) {
  const endpoint = new URL("https://nominatim.openstreetmap.org/search");
  endpoint.searchParams.set("format", "jsonv2");
  endpoint.searchParams.set("limit", String(limit));
  endpoint.searchParams.set("accept-language", "sv");
  endpoint.searchParams.set("addressdetails", "1");
  endpoint.searchParams.set("dedupe", "1");
  endpoint.searchParams.set("q", query);
  if (swedenOnly) {
    endpoint.searchParams.set("countrycodes", "se");
  }

  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      return [];
    }
    return response.json();
  } catch (error) {
    if (error.name !== "AbortError") {
      setStatus("Adressen kunde inte sökas just nu.");
    }
    return [];
  }
}

function renderSuggestions(container, results, kind) {
  container.innerHTML = "";
  if (!results.length) {
    container.classList.remove("is-open");
    return;
  }

  results.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion-item";
    button.innerHTML = `<strong>${escapeHtml(firstLine(item.display_name))}</strong><span>${escapeHtml(item.display_name)}</span>`;
    button.addEventListener("click", () => {
      applyResolvedPlace(kind, item);
      closeSuggestions(kind);
      if (window.innerWidth < 980) {
        setPanelOpen(true);
      }
    });
    container.appendChild(button);
  });

  container.classList.add("is-open");
}

async function resolveTypedAddress(kind) {
  if (kind === "start" && state.startMode === "current") {
    return state.currentLocation;
  }

  const input = kind === "start" ? els.startInput : els.endInput;
  const existingPoint = kind === "start" ? state.startPoint : state.endPoint;
  const text = input.value.trim();

  if (!text) {
    return existingPoint;
  }

  if (existingPoint && (existingPoint.displayName === text || existingPoint.label === text)) {
    return existingPoint;
  }

  const results = await fetchGeocodeSuggestions(text, kind, 1);
  if (!results.length) {
    setSummaryMessage(`Hittade inte adressen: ${text}`, "error");
    return null;
  }

  closeSuggestions(kind);
  return applyResolvedPlace(kind, results[0], text);
}
function applyResolvedPlace(kind, item, typedLabel) {
  const point = toPoint(Number(item.lat), Number(item.lon), {
    label: typedLabel || item.display_name,
    displayName: item.display_name,
    source: "search",
  });

  if (kind === "start") {
    state.startPoint = point;
    els.startInput.value = typedLabel || item.display_name;
    updateMarker("start", point, "start");
  } else {
    state.endPoint = point;
    els.endInput.value = typedLabel || item.display_name;
    updateMarker("end", point, "end");
  }

  setStatus("Adress vald.");
  return point;
}

function closeSuggestions(kind) {
  const container = kind === "start" ? els.startSuggestions : els.endSuggestions;
  container.classList.remove("is-open");
}

function toggleMapPicker(kind) {
  state.pickingMode = state.pickingMode === kind ? null : kind;
  renderMapPickerToast();
}

function renderMapPickerToast() {
  const existing = document.querySelector(".map-picker-toast");
  if (existing) {
    existing.remove();
  }

  if (!state.pickingMode) {
    return;
  }

  const toast = document.createElement("div");
  toast.className = "map-picker-toast";
  toast.textContent =
    state.pickingMode === "start"
      ? "Tryck på kartan för att välja start."
      : "Tryck på kartan för att välja destination.";
  document.querySelector(".map-stage").appendChild(toast);
}

function handleMapClick(event) {
  if (window.innerWidth < 980 && state.panelOpen && !state.pickingMode) {
    setPanelOpen(false);
  }

  if (!state.pickingMode) {
    return;
  }

  const point = toPoint(event.latlng.lat, event.latlng.lng, {
    label: formatLatLon({ lat: event.latlng.lat, lon: event.latlng.lng }),
    source: "map",
  });

  if (state.pickingMode === "start") {
    if (state.startMode === "current") {
      state.startMode = "manual";
      updateStartMode();
    }
    state.startPoint = point;
    els.startInput.value = point.label;
    updateMarker("start", point, "start");
  } else {
    state.endPoint = point;
    els.endInput.value = point.label;
    updateMarker("end", point, "end");
  }

  state.pickingMode = null;
  renderMapPickerToast();
}

async function ensureResolvedInputs() {
  if (state.startMode === "manual") {
    const resolvedStart = await resolveTypedAddress("start");
    if (!resolvedStart) {
      return false;
    }
  }

  const resolvedEnd = await resolveTypedAddress("end");
  if (!resolvedEnd) {
    return false;
  }

  return true;
}

async function buildRoute() {
  const requestId = ++state.lastRouteRequestId;
  const vehicle = VEHICLES[state.vehicle];

  els.routeButton.disabled = true;
  els.startNavigation.disabled = true;

  try {
    const resolved = await ensureResolvedInputs();
    if (!resolved) {
      return;
    }

    const startPoint = state.startMode === "current" ? state.currentLocation : state.startPoint;
    const endPoint = state.endPoint;

    if (!startPoint) {
      setSummaryMessage("Välj startpunkt först.", "error");
      return;
    }

    if (!endPoint) {
      setSummaryMessage("Välj destination först.", "error");
      return;
    }

    if (haversineKm(startPoint, endPoint) > 80) {
      setSummaryMessage("Rutten är för lång. Testa en närmare adress.", "error");
      return;
    }

    setStatus("Beräknar rutt…");
    const network = await fetchRoadNetwork(startPoint, endPoint, vehicle);
    if (requestId !== state.lastRouteRequestId) {
      return;
    }

    const result = calculateRoute(network, startPoint, endPoint, vehicle);
    if (!result) {
      state.route = null;
      clearRouteLayer();
      els.distanceOutput.textContent = "-";
      els.etaOutput.textContent = "-";
      els.routeTypeOutput.textContent = "Ingen rutt";
      els.directionsList.innerHTML = "";
      els.navTitle.textContent = "Ingen rutt";
      els.navBody.textContent = "Testa en annan adress eller en annan fordonsprofil.";
      setSummaryMessage("Det gick inte att beräkna någon rutt här.", "error");
      setStatus("Ingen rutt hittades.");
      return;
    }

    state.route = result;
    drawRoute(result.coordinates);
    renderRouteSummary(result, vehicle);
    setStatus("Rutten är klar.");
    if (window.innerWidth < 980) {
      setPanelOpen(false);
    }
  } catch (error) {
    console.error(error);
    setSummaryMessage("Karttjänsten svarade inte just nu.", "error");
    setStatus("Ruttberäkningen misslyckades.");
  } finally {
    els.routeButton.disabled = false;
    els.startNavigation.disabled = !state.route;
  }
}

async function fetchRoadNetwork(startPoint, endPoint, vehicle) {
  const directDistanceKm = haversineKm(startPoint, endPoint);
  const attemptBuffersKm = [
    Math.max(1.5, directDistanceKm * 0.35),
    Math.max(3.5, directDistanceKm * 0.55),
    Math.max(6.5, directDistanceKm * 0.9),
  ];

  let lastError = null;

  for (const bufferKm of attemptBuffersKm) {
    const bbox = buildBBox(startPoint, endPoint, bufferKm);
    const cacheKey = `${vehicle.id}:${bbox.join(",")}`;
    if (networkCache.has(cacheKey)) {
      const cached = networkCache.get(cacheKey);
      if (cached.segments.length) {
        return cached;
      }
    }

    try {
      const data = await queryOverpass(bbox);
      const graph = buildGraph(data, vehicle);
      networkCache.set(cacheKey, graph);
      if (graph.segments.length) {
        return graph;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return { adjacency: new Map(), segments: [] };
}

async function queryOverpass(bbox) {
  const [south, west, north, east] = bbox;
  const query = `
[out:json][timeout:25];
(
  way["highway"](${south},${west},${north},${east});
);
(._;>;);
out body;
  `.trim();

  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({ data: query }),
  });

  if (!response.ok) {
    throw new Error(`Overpass ${response.status}`);
  }

  return response.json();
}

function buildGraph(data, vehicle) {
  const nodes = new Map();
  const adjacency = new Map();
  const segments = [];

  for (const element of data.elements || []) {
    if (element.type === "node") {
      nodes.set(element.id, { id: element.id, lat: element.lat, lon: element.lon });
    }
  }

  for (const element of data.elements || []) {
    if (element.type !== "way" || !isWayAllowed(element.tags || {}, vehicle)) {
      continue;
    }

    const tags = element.tags || {};
    const onewayMode = getOnewayMode(tags);

    for (let index = 0; index < element.nodes.length - 1; index += 1) {
      const fromId = element.nodes[index];
      const toId = element.nodes[index + 1];
      const fromNode = nodes.get(fromId);
      const toNode = nodes.get(toId);
      if (!fromNode || !toNode) {
        continue;
      }

      const distanceKm = haversineKm(fromNode, toNode);
      if (!distanceKm) {
        continue;
      }

      const edgeMeta = {
        distanceKm,
        durationMin: estimateEdgeMinutes(distanceKm, tags),
        name: tags.name || readableHighwayName(tags.highway),
        highway: tags.highway,
        tags,
        from: fromId,
        to: toId,
        fromCoord: [fromNode.lat, fromNode.lon],
        toCoord: [toNode.lat, toNode.lon],
      };

      segments.push(edgeMeta);

      if (onewayMode === "both" || onewayMode === "forward") {
        pushEdge(adjacency, fromId, edgeMeta);
      }

      if (onewayMode === "both" || onewayMode === "reverse") {
        pushEdge(adjacency, toId, {
          ...edgeMeta,
          from: toId,
          to: fromId,
          fromCoord: [toNode.lat, toNode.lon],
          toCoord: [fromNode.lat, fromNode.lon],
        });
      }
    }
  }

  return { nodes, adjacency, segments };
}

function isWayAllowed(tags, vehicle) {
  const highway = tags.highway;
  if (!highway) {
    return false;
  }

  if (
    highway === "motorway" ||
    highway === "motorway_link" ||
    highway === "steps" ||
    highway === "footway" ||
    highway === "pedestrian" ||
    highway === "bridleway" ||
    highway === "construction"
  ) {
    return false;
  }

  if (
    BLOCKED_ACCESS.has(tags.access) ||
    BLOCKED_ACCESS.has(tags.vehicle) ||
    BLOCKED_ACCESS.has(tags.motor_vehicle) ||
    tags.motorroad === "yes" ||
    tags.moped === "no" ||
    tags.mofa === "no"
  ) {
    return false;
  }

  if (highway === "service" && tags.service === "parking_aisle") {
    return false;
  }

  if (ROAD_BASE.has(highway)) {
    return true;
  }

  if (!vehicle.allowCycleways || !CLASS2_EXTRA.has(highway)) {
    return false;
  }

  if (highway === "path") {
    return (
      tags.bicycle === "yes" ||
      tags.bicycle === "designated" ||
      tags.moped === "yes" ||
      tags.mofa === "yes"
    );
  }

  return tags.bicycle !== "no";
}

function getOnewayMode(tags) {
  if (tags.oneway === "-1") {
    return "reverse";
  }
  if (tags.oneway === "yes" || tags.junction === "roundabout") {
    return "forward";
  }
  return "both";
}

function estimateEdgeMinutes(distanceKm, tags) {
  const chosenSpeed = clampSpeed(Number(els.speedSlider.value));
  const roadLimit = deriveRoadLimit(tags);
  const comfortFactor = tags.highway === "cycleway" || tags.highway === "path" ? 0.78 : 0.84;
  const effectiveSpeed = Math.max(8, Math.min(chosenSpeed * 0.82, roadLimit * comfortFactor));
  return (distanceKm / effectiveSpeed) * 60;
}

function deriveRoadLimit(tags) {
  const parsed = parseMaxSpeed(tags.maxspeed);
  if (parsed) {
    return parsed;
  }

  switch (tags.highway) {
    case "trunk":
    case "primary":
      return 80;
    case "secondary":
    case "secondary_link":
      return 70;
    case "tertiary":
    case "tertiary_link":
      return 60;
    case "residential":
    case "living_street":
      return 30;
    case "cycleway":
    case "path":
      return 25;
    case "service":
      return 25;
    default:
      return 50;
  }
}

function parseMaxSpeed(rawValue) {
  if (!rawValue) {
    return null;
  }

  const direct = Number(String(rawValue).replace(/[^\d]/g, ""));
  return Number.isFinite(direct) && direct > 0 ? direct : null;
}

function calculateRoute(network, startPoint, endPoint, vehicle) {
  if (!network.segments.length) {
    return null;
  }

  const startVirtual = connectVirtualPoint(network, startPoint, "virtual-start");
  const endVirtual = connectVirtualPoint(network, endPoint, "virtual-end");

  if (!startVirtual || !endVirtual) {
    return null;
  }

  const adjacency = cloneAdjacency(network.adjacency);
  injectVirtualConnections(adjacency, startVirtual);
  injectVirtualConnections(adjacency, endVirtual);

  const path = shortestPath(adjacency, startVirtual.id, endVirtual.id);
  if (!path) {
    return null;
  }

  return buildRoutePayload(path, startPoint, endPoint, vehicle);
}
function connectVirtualPoint(network, point, virtualId) {
  let bestSegment = null;
  let bestProjection = null;
  let shortestDistance = Infinity;

  for (const segment of network.segments) {
    const projection = projectPointOntoSegment(point, segment.fromCoord, segment.toCoord);
    if (!projection) {
      continue;
    }
    if (projection.distanceKm < shortestDistance) {
      shortestDistance = projection.distanceKm;
      bestProjection = projection;
      bestSegment = segment;
    }
  }

  if (!bestSegment || !bestProjection) {
    return null;
  }

  const tags = bestSegment.tags || {};
  const roadName = bestSegment.name || readableHighwayName(tags.highway);
  const projectedPoint = toPoint(bestProjection.lat, bestProjection.lon, {
    label: roadName,
    source: "projection",
  });

  const totalDistance = bestSegment.distanceKm;
  const fromDistance = totalDistance * bestProjection.ratio;
  const toDistance = Math.max(totalDistance - fromDistance, 0);
  const onewayMode = getOnewayMode(tags);
  const links = [];
  const minutes = (km) => estimateEdgeMinutes(km, tags);

  if (onewayMode === "both") {
    links.push(
      makeLink(virtualId, bestSegment.from, fromDistance, minutes(fromDistance), roadName, tags, [projectedPoint.lat, projectedPoint.lon], bestSegment.fromCoord),
      makeLink(bestSegment.from, virtualId, fromDistance, minutes(fromDistance), roadName, tags, bestSegment.fromCoord, [projectedPoint.lat, projectedPoint.lon]),
      makeLink(virtualId, bestSegment.to, toDistance, minutes(toDistance), roadName, tags, [projectedPoint.lat, projectedPoint.lon], bestSegment.toCoord),
      makeLink(bestSegment.to, virtualId, toDistance, minutes(toDistance), roadName, tags, bestSegment.toCoord, [projectedPoint.lat, projectedPoint.lon])
    );
  }

  if (onewayMode === "forward") {
    links.push(
      makeLink(virtualId, bestSegment.to, toDistance, minutes(toDistance), roadName, tags, [projectedPoint.lat, projectedPoint.lon], bestSegment.toCoord),
      makeLink(bestSegment.from, virtualId, fromDistance, minutes(fromDistance), roadName, tags, bestSegment.fromCoord, [projectedPoint.lat, projectedPoint.lon])
    );
  }

  if (onewayMode === "reverse") {
    links.push(
      makeLink(virtualId, bestSegment.from, fromDistance, minutes(fromDistance), roadName, tags, [projectedPoint.lat, projectedPoint.lon], bestSegment.fromCoord),
      makeLink(bestSegment.to, virtualId, toDistance, minutes(toDistance), roadName, tags, bestSegment.toCoord, [projectedPoint.lat, projectedPoint.lon])
    );
  }

  return {
    id: virtualId,
    point: projectedPoint,
    links: links.filter((link) => link.distanceKm >= 0),
  };
}

function makeLink(from, to, distanceKm, durationMin, name, tags, fromCoord, toCoord) {
  return {
    from,
    to,
    distanceKm,
    durationMin,
    name,
    tags,
    highway: tags.highway,
    fromCoord,
    toCoord,
  };
}

function cloneAdjacency(adjacency) {
  const clone = new Map();
  for (const [key, edges] of adjacency.entries()) {
    clone.set(key, edges.map((edge) => ({ ...edge })));
  }
  return clone;
}

function injectVirtualConnections(adjacency, virtualNode) {
  adjacency.set(virtualNode.id, adjacency.get(virtualNode.id) || []);
  for (const link of virtualNode.links) {
    pushEdge(adjacency, link.from, link);
  }
}

function shortestPath(adjacency, startId, endId) {
  const heap = new MinHeap();
  const distances = new Map([[startId, 0]]);
  const previous = new Map();

  heap.push({ id: startId, cost: 0 });

  while (!heap.isEmpty()) {
    const current = heap.pop();
    if (!current) {
      break;
    }

    if (current.id === endId) {
      break;
    }

    if (current.cost > (distances.get(current.id) ?? Infinity)) {
      continue;
    }

    const neighbors = adjacency.get(current.id) || [];
    for (const edge of neighbors) {
      const nextCost = current.cost + edge.distanceKm;
      if (nextCost < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, nextCost);
        previous.set(edge.to, { node: current.id, edge });
        heap.push({ id: edge.to, cost: nextCost });
      }
    }
  }

  if (!previous.has(endId)) {
    return null;
  }

  const steps = [];
  let cursor = endId;

  while (cursor !== startId) {
    const entry = previous.get(cursor);
    if (!entry) {
      return null;
    }
    steps.push(entry.edge);
    cursor = entry.node;
  }

  steps.reverse();
  return { edges: steps };
}

function buildRoutePayload(path, startPoint, endPoint, vehicle) {
  let totalDistanceKm = 0;
  let totalMinutes = 0;
  const coordinates = [[startPoint.lat, startPoint.lon]];
  const roadMix = {
    cyclewaysKm: 0,
    smallRoadsKm: 0,
    largerRoadsKm: 0,
  };

  for (const edge of path.edges) {
    totalDistanceKm += edge.distanceKm;
    totalMinutes += edge.durationMin;

    if (!sameCoord(coordinates[coordinates.length - 1], edge.fromCoord)) {
      coordinates.push(edge.fromCoord);
    }
    if (!sameCoord(coordinates[coordinates.length - 1], edge.toCoord)) {
      coordinates.push(edge.toCoord);
    }

    if (edge.highway === "cycleway" || edge.highway === "path") {
      roadMix.cyclewaysKm += edge.distanceKm;
    } else if (
      edge.highway === "residential" ||
      edge.highway === "service" ||
      edge.highway === "living_street" ||
      edge.highway === "unclassified"
    ) {
      roadMix.smallRoadsKm += edge.distanceKm;
    } else {
      roadMix.largerRoadsKm += edge.distanceKm;
    }
  }

  if (!sameCoord(coordinates[coordinates.length - 1], [endPoint.lat, endPoint.lon])) {
    coordinates.push([endPoint.lat, endPoint.lon]);
  }

  return {
    coordinates,
    totalDistanceKm,
    totalMinutes,
    directions: buildDirections(path.edges, endPoint),
    routeProfile: summarizeRouteProfile(roadMix, vehicle),
  };
}

function buildDirections(edges, endPoint) {
  if (!edges.length) {
    return [];
  }

  const instructions = [];
  let chunkDistance = 0;
  let currentName = edges[0].name;
  let lastBearing = bearingBetween(edges[0].fromCoord, edges[0].toCoord);

  instructions.push(`Starta på ${currentName}.`);

  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    chunkDistance += edge.distanceKm;
    const nextEdge = edges[index + 1];

    if (!nextEdge) {
      instructions.push(`Fortsätt i ${formatDistance(chunkDistance)} tills du är framme.`);
      break;
    }

    const sameRoad = nextEdge.name === currentName;
    const nextBearing = bearingBetween(nextEdge.fromCoord, nextEdge.toCoord);
    const turn = getTurnInstruction(lastBearing, nextBearing);

    if (!sameRoad || turn !== "fortsätt rakt fram") {
      instructions.push(`${capitalize(turn)} mot ${nextEdge.name} efter ${formatDistance(chunkDistance)}.`);
      chunkDistance = 0;
      currentName = nextEdge.name;
    }

    lastBearing = nextBearing;
  }

  return instructions.slice(0, 6);
}

function getTurnInstruction(previousBearing, nextBearing) {
  const delta = normalizeBearing(nextBearing - previousBearing);
  const absolute = Math.abs(delta);

  if (absolute < 18) {
    return "fortsätt rakt fram";
  }
  if (absolute < 45) {
    return delta > 0 ? "håll svagt höger" : "håll svagt vänster";
  }
  if (absolute < 120) {
    return delta > 0 ? "sväng höger" : "sväng vänster";
  }
  return "gör en tydlig sväng";
}

function summarizeRouteProfile(roadMix, vehicle) {
  const cycle = roadMix.cyclewaysKm;
  const small = roadMix.smallRoadsKm;
  const larger = roadMix.largerRoadsKm;

  if (vehicle.allowCycleways && cycle > Math.max(small, larger)) {
    return "Mest cykelväg";
  }
  if (small >= larger) {
    return "Småvägar först";
  }
  return "Blandad landsväg";
}

function renderRouteSummary(route) {
  els.distanceOutput.textContent = formatDistance(route.totalDistanceKm);
  els.etaOutput.textContent = formatMinutes(route.totalMinutes);
  els.routeTypeOutput.textContent = route.routeProfile;
  els.directionsList.innerHTML = "";
  route.directions.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    els.directionsList.appendChild(li);
  });
  els.navTitle.textContent = `${formatDistance(route.totalDistanceKm)} kvar`;
  els.navBody.textContent = `${formatMinutes(route.totalMinutes)} • ${route.routeProfile}`;
  setSummaryMessage(`Rutt klar: ${formatDistance(route.totalDistanceKm)} • ${formatMinutes(route.totalMinutes)}`, "success");
}

function drawRoute(coordinates) {
  clearRouteLayer();

  const outline = L.polyline(coordinates, {
    color: "#ffffff",
    weight: 13,
    opacity: 0.44,
    lineCap: "round",
    lineJoin: "round",
  }).addTo(state.map);

  const routeLine = L.polyline(coordinates, {
    color: "#1473ff",
    weight: 7,
    opacity: 0.94,
    lineJoin: "round",
  }).addTo(state.map);

  state.layers.route = { line: routeLine, outline };
  routeLine.bringToFront();
  focusRelevantBounds();
}

function clearRouteLayer() {
  if (state.layers.route?.outline) {
    state.map.removeLayer(state.layers.route.outline);
  }
  if (state.layers.route?.line) {
    state.map.removeLayer(state.layers.route.line);
  }
  state.layers.route = null;
}

function startNavigationMode() {
  if (!state.route) {
    return;
  }

  const startPoint = state.startMode === "current" ? state.currentLocation || state.startPoint : state.startPoint;
  if (startPoint) {
    state.map.flyTo([startPoint.lat, startPoint.lon], 17.75, { duration: 1.1 });
  }

  els.navTitle.textContent = "Navigation aktiv";
  els.navBody.textContent = "Kartbilden följer din plats.";

  if (window.innerWidth < 980) {
    setPanelOpen(false);
  }

  if (navigator.geolocation) {
    if (state.navWatchId) {
      navigator.geolocation.clearWatch(state.navWatchId);
    }
    state.navWatchId = navigator.geolocation.watchPosition(
      (position) => {
        const point = toPoint(position.coords.latitude, position.coords.longitude, {
          label: "Nuvarande plats",
          source: "current",
        });
        state.currentLocation = point;
        updateMarker("current", point, "current");
        if (state.startMode === "current") {
          updateMarker("start", point, "start");
        }
        state.map.flyTo([point.lat, point.lon], Math.max(state.map.getZoom(), 17.5), {
          animate: true,
          duration: 0.55,
        });
      },
      () => {
        setStatus("Positionen kunde inte uppdateras.");
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000,
      }
    );
  }
}

function focusRelevantBounds() {
  if (state.route?.coordinates?.length) {
    state.map.fitBounds(state.route.coordinates, {
      padding: [38, 38],
      maxZoom: 16,
    });
    return;
  }

  const points = [];
  if (state.startPoint) {
    points.push([state.startPoint.lat, state.startPoint.lon]);
  }
  if (state.currentLocation && state.startMode === "current") {
    points.push([state.currentLocation.lat, state.currentLocation.lon]);
  }
  if (state.endPoint) {
    points.push([state.endPoint.lat, state.endPoint.lon]);
  }

  if (points.length >= 2) {
    state.map.fitBounds(points, { padding: [38, 38], maxZoom: 15.5 });
  }
}

function updateMarker(kind, point, markerType) {
  removeMarker(kind);
  const marker = L.marker([point.lat, point.lon], { icon: createMarkerIcon(markerType) }).addTo(state.map);
  state.markers[kind] = marker;
}

function removeMarker(kind) {
  if (state.markers[kind]) {
    state.map.removeLayer(state.markers[kind]);
    state.markers[kind] = null;
  }
}

function createMarkerIcon(markerType) {
  const ring = markerType === "current" ? '<span class="pulse-ring"></span>' : "";
  return L.divIcon({
    className: "",
    html: `<div class="marker-pin ${markerType}">${ring}</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function swapLocations() {
  if (state.startMode === "current") {
    setSummaryMessage("Byt fungerar bara om du själv skrivit en startadress.", "error");
    return;
  }

  const tempPoint = state.startPoint;
  const tempValue = els.startInput.value;
  state.startPoint = state.endPoint;
  state.endPoint = tempPoint;
  els.startInput.value = els.endInput.value;
  els.endInput.value = tempValue;

  if (state.startPoint) {
    updateMarker("start", state.startPoint, "start");
  } else {
    removeMarker("start");
  }

  if (state.endPoint) {
    updateMarker("end", state.endPoint, "end");
  } else {
    removeMarker("end");
  }
}

function clearRouteAndInputs() {
  state.route = null;
  state.endPoint = null;
  clearRouteLayer();
  removeMarker("end");
  els.endInput.value = "";
  els.distanceOutput.textContent = "-";
  els.etaOutput.textContent = "-";
  els.routeTypeOutput.textContent = "-";
  els.directionsList.innerHTML = "";
  els.startNavigation.disabled = true;
  setSummaryMessage("Välj start och destination.", "info");

  if (state.navWatchId && navigator.geolocation) {
    navigator.geolocation.clearWatch(state.navWatchId);
    state.navWatchId = null;
  }

  if (state.startMode === "manual") {
    state.startPoint = null;
    removeMarker("start");
    els.startInput.value = "";
  } else if (state.currentLocation) {
    state.startPoint = state.currentLocation;
    updateMarker("start", state.currentLocation, "start");
  }

  els.navTitle.textContent = "Ingen aktiv rutt";
  els.navBody.textContent = "Beräkna en rutt för att visa vägen.";
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function setSummaryMessage(message, tone = "info") {
  els.summaryNote.textContent = message;
  els.summaryNote.dataset.tone = tone;
}

function pushEdge(adjacency, fromId, edge) {
  if (!adjacency.has(fromId)) {
    adjacency.set(fromId, []);
  }
  adjacency.get(fromId).push(edge);
}

function buildBBox(a, b, bufferKm) {
  const latPadding = bufferKm / 111;
  const meanLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const lonPadding = bufferKm / (111 * Math.max(Math.cos(meanLat), 0.2));

  return [
    Math.min(a.lat, b.lat) - latPadding,
    Math.min(a.lon, b.lon) - lonPadding,
    Math.max(a.lat, b.lat) + latPadding,
    Math.max(a.lon, b.lon) + lonPadding,
  ].map((value) => Number(value.toFixed(5)));
}

function toPoint(lat, lon, extra = {}) {
  return { lat, lon, ...extra };
}

function projectPointOntoSegment(point, fromCoord, toCoord) {
  const ax = fromCoord[1];
  const ay = fromCoord[0];
  const bx = toCoord[1];
  const by = toCoord[0];
  const px = point.lon;
  const py = point.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;

  if (!lengthSq) {
    return null;
  }

  const ratio = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const projLon = ax + ratio * dx;
  const projLat = ay + ratio * dy;

  return {
    lat: projLat,
    lon: projLon,
    ratio,
    distanceKm: haversineKm(point, { lat: projLat, lon: projLon }),
  };
}

function haversineKm(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const c = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 6371 * 2 * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

function bearingBetween(fromCoord, toCoord) {
  const fromLat = fromCoord[0] * (Math.PI / 180);
  const fromLon = fromCoord[1] * (Math.PI / 180);
  const toLat = toCoord[0] * (Math.PI / 180);
  const toLon = toCoord[1] * (Math.PI / 180);
  const y = Math.sin(toLon - fromLon) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(toLon - fromLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function normalizeBearing(value) {
  if (value > 180) {
    return value - 360;
  }
  if (value < -180) {
    return value + 360;
  }
  return value;
}

function readableHighwayName(highway) {
  switch (highway) {
    case "trunk":
    case "primary":
      return "huvudled";
    case "secondary":
    case "tertiary":
      return "landsväg";
    case "residential":
    case "living_street":
      return "lokalgata";
    case "cycleway":
      return "cykelväg";
    case "path":
      return "cykelstråk";
    case "service":
      return "småväg";
    default:
      return "väg";
  }
}

function formatDistance(km) {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(km >= 10 ? 1 : 2)} km`;
}

function formatMinutes(minutes) {
  const rounded = Math.max(1, Math.round(minutes));
  if (rounded < 60) {
    return `${rounded} min`;
  }
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return mins ? `${hours} h ${mins} min` : `${hours} h`;
}

function formatLatLon(point) {
  return `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
}

function clampSpeed(value) {
  if (!Number.isFinite(value)) {
    return 45;
  }
  return Math.min(100, Math.max(10, Math.round(value)));
}

function firstLine(value) {
  return value.split(",")[0] || value;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sameCoord(a, b) {
  return a && b && a[0] === b[0] && a[1] === b[1];
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(item) {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop() {
    if (!this.items.length) {
      return null;
    }
    const root = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return root;
  }

  bubbleUp(index) {
    let currentIndex = index;
    while (currentIndex > 0) {
      const parentIndex = Math.floor((currentIndex - 1) / 2);
      if (this.items[parentIndex].cost <= this.items[currentIndex].cost) {
        break;
      }
      [this.items[parentIndex], this.items[currentIndex]] = [
        this.items[currentIndex],
        this.items[parentIndex],
      ];
      currentIndex = parentIndex;
    }
  }

  bubbleDown(index) {
    let currentIndex = index;
    while (true) {
      const leftIndex = currentIndex * 2 + 1;
      const rightIndex = currentIndex * 2 + 2;
      let smallest = currentIndex;

      if (
        leftIndex < this.items.length &&
        this.items[leftIndex].cost < this.items[smallest].cost
      ) {
        smallest = leftIndex;
      }

      if (
        rightIndex < this.items.length &&
        this.items[rightIndex].cost < this.items[smallest].cost
      ) {
        smallest = rightIndex;
      }

      if (smallest === currentIndex) {
        break;
      }

      [this.items[currentIndex], this.items[smallest]] = [
        this.items[smallest],
        this.items[currentIndex],
      ];
      currentIndex = smallest;
    }
  }

  isEmpty() {
    return this.items.length === 0;
  }
}
