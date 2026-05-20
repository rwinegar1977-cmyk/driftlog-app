import React, { useMemo, useState } from "react";
import {
  MapPin,
  Plus,
  Fish,
  BarChart3,
  Library,
  Waves,
  Moon,
  CloudSun,
  Timer,
  Share2,
  Camera,
  Navigation,
  Search,
  LocateFixed,
  RefreshCw,
} from "lucide-react";
import { motion } from "framer-motion";

function uid() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const starterFlies = [
  { id: uid(), name: "Micro Shad", type: "Streamer", color: "Pearl/Gray", size: "#8", target: "Bass, Trout, Panfish" },
  { id: uid(), name: "Riffle May Nymph", type: "Nymph", color: "Olive/Brown", size: "#12", target: "Trout, Sunfish" },
  { id: uid(), name: "Pebble Craw Micro Jig", type: "Micro Jig", color: "Rust/Olive", size: "1/32 oz", target: "Guadalupe Bass" },
  { id: uid(), name: "Mop Dragon", type: "Nymph/Jig", color: "Olive", size: "#10", target: "Bass, Panfish" },
];

const starterTechniques = ["Dead Drift", "Slow Strip", "Swing", "Hop and Drop", "Pop and Pause", "Bottom Bounce", "Sight Cast"];
const clarityOptions = ["Clear", "Slightly stained", "Stained", "Muddy", "High and dirty", "Low and clear", "Algae bloom"];
const speciesOptions = ["Guadalupe Bass", "Largemouth Bass", "Smallmouth Bass", "Rainbow Trout", "Brown Trout", "Sunfish", "Crappie", "Redfish", "Speckled Trout", "Other"];
const weatherCodes = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Heavy showers",
  82: "Violent showers",
  95: "Thunderstorm",
};
const storageKey = "driftlog-data-v1";

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function Card({ children, className = "" }) {
  return <div className={cx("rounded-2xl border border-teal-400/20 bg-white/[0.07] p-4 shadow-xl backdrop-blur", className)}>{children}</div>;
}

function Pill({ children }) {
  return <span className="rounded-full border border-teal-300/30 bg-teal-300/10 px-3 py-1 text-xs text-teal-100">{children}</span>;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatCoords(coords) {
  if (!coords) return "Location not set";
  return `${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)}`;
}

function moonPhaseName(date = new Date()) {
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14);
  const lunarCycle = 29.530588853;
  const days = (date.getTime() - knownNewMoon) / 86400000;
  const phase = ((days % lunarCycle) + lunarCycle) % lunarCycle;
  if (phase < 1.84566) return "New moon";
  if (phase < 5.53699) return "Waxing crescent";
  if (phase < 9.22831) return "First quarter";
  if (phase < 12.91963) return "Waxing gibbous";
  if (phase < 16.61096) return "Full moon";
  if (phase < 20.30228) return "Waning gibbous";
  if (phase < 23.99361) return "Last quarter";
  if (phase < 27.68493) return "Waning crescent";
  return "New moon";
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is not available in this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000,
    });
  });
}

async function fetchWeather(coords) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: coords.latitude,
    longitude: coords.longitude,
    current: "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto",
  });
  const response = await fetch(url);
  if (!response.ok) throw new Error("Weather service did not respond.");
  const data = await response.json();
  const current = data.current;
  const description = weatherCodes[current.weather_code] || "Current conditions";
  return `${Math.round(current.temperature_2m)}F, ${description}, wind ${Math.round(current.wind_speed_10m)} mph, humidity ${current.relative_humidity_2m}%`;
}

async function fetchRiverFlow(coords) {
  const sitesUrl = new URL("https://waterservices.usgs.gov/nwis/site/");
  sitesUrl.search = new URLSearchParams({
    format: "rdb",
    bBox: nearbyBox(coords, 0.35),
    siteType: "ST",
    siteStatus: "active",
    hasDataTypeCd: "dv",
    parameterCd: "00060",
  });

  const sitesText = await fetchText(sitesUrl);
  const sites = parseUsgsRdb(sitesText).filter((site) => site.dec_lat_va && site.dec_long_va);
  if (!sites.length) return "No active USGS stream gauge nearby";

  const nearest = sites
    .map((site) => ({
      site,
      distance: distanceMiles(coords.latitude, coords.longitude, Number(site.dec_lat_va), Number(site.dec_long_va)),
    }))
    .sort((a, b) => a.distance - b.distance)[0];

  const valuesUrl = new URL("https://waterservices.usgs.gov/nwis/iv/");
  valuesUrl.search = new URLSearchParams({
    format: "json",
    sites: nearest.site.site_no,
    parameterCd: "00060",
    siteStatus: "all",
  });

  const response = await fetch(valuesUrl);
  if (!response.ok) throw new Error("USGS flow service did not respond.");
  const data = await response.json();
  const value = data.value?.timeSeries?.[0]?.values?.[0]?.value?.[0]?.value;
  const flow = value ? `${Number(value).toLocaleString()} CFS` : "CFS unavailable";
  return `${flow} at ${nearest.site.station_nm} (${nearest.distance.toFixed(1)} mi)`;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("USGS site service did not respond.");
  return response.text();
}

function nearbyBox(coords, span) {
  const west = coords.longitude - span;
  const south = coords.latitude - span;
  const east = coords.longitude + span;
  const north = coords.latitude + span;
  return [west, south, east, north].map((n) => n.toFixed(5)).join(",");
}

function parseUsgsRdb(text) {
  const rows = text.split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
  if (rows.length < 3) return [];
  const headers = rows[0].split("\t");
  return rows.slice(2).map((row) => {
    const values = row.split("\t");
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const radius = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function loadStoredData() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return {};
    return JSON.parse(saved);
  } catch {
    return {};
  }
}

function saveStoredData(data) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read photo."));
    reader.readAsDataURL(file);
  });
}

export default function DriftLogApp() {
  const storedData = useMemo(() => loadStoredData(), []);
  const [tab, setTab] = useState("home");
  const [trips, setTrips] = useState(storedData.trips || []);
  const [flies, setFlies] = useState(storedData.flies || starterFlies);
  const [techniques, setTechniques] = useState(storedData.techniques || starterTechniques);
  const [activeTrip, setActiveTrip] = useState(storedData.activeTrip || null);
  const [now, setNow] = useState(Date.now());
  const [showCatch, setShowCatch] = useState(false);
  const [status, setStatus] = useState(storedData.activeTrip ? "Active trip restored." : "");
  const [isUpdatingConditions, setIsUpdatingConditions] = useState(false);

  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  React.useEffect(() => {
    const saved = saveStoredData({ trips, flies, techniques, activeTrip });
    if (!saved) setStatus("Storage is full. New data may not persist until photos or trips are reduced.");
  }, [trips, flies, techniques, activeTrip]);

  const allCatches = trips.flatMap((t) => t.catches || []);
  const bestFly = useMemo(() => mostCommon(allCatches.map((c) => c.flyOrLure)) || "Not enough data", [allCatches]);
  const bestTechnique = useMemo(() => mostCommon(allCatches.map((c) => c.technique)) || "Not enough data", [allCatches]);

  async function startTrip() {
    const trip = {
      id: uid(),
      title: "Fishing Trip",
      date: new Date().toISOString(),
      startTime: Date.now(),
      endTime: null,
      locationName: "Getting location...",
      waterType: "River",
      waterClarity: "Slightly stained",
      weather: "Getting weather...",
      moon: moonPhaseName(),
      riverCFS: "Finding river gauge...",
      catches: [],
      notes: "",
      track: [],
    };
    setActiveTrip(trip);
    setStatus("Requesting location permission...");

    try {
      const position = await getCurrentPosition();
      const coords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
      };
      const updatedTrip = {
        ...trip,
        locationName: formatCoords(coords),
        coords,
        track: [{ ...coords, time: new Date().toISOString() }],
      };
      setActiveTrip(updatedTrip);
      setStatus("Location captured. Pulling conditions...");
      await refreshConditions(updatedTrip, coords);
    } catch (error) {
      setActiveTrip({ ...trip, locationName: "Location unavailable", weather: "Manual entry needed", riverCFS: "Manual entry needed" });
      setStatus(error.message || "Could not get location.");
    }
  }

  async function refreshConditions(trip = activeTrip, coords = activeTrip?.coords) {
    if (!trip || !coords) {
      setStatus("Start location is needed before fetching conditions.");
      return;
    }

    setIsUpdatingConditions(true);
    setStatus("Updating weather and river flow...");
    try {
      const [weatherResult, riverResult] = await Promise.allSettled([fetchWeather(coords), fetchRiverFlow(coords)]);
      const nextTrip = {
        ...trip,
        moon: moonPhaseName(new Date(trip.date)),
        weather: weatherResult.status === "fulfilled" ? weatherResult.value : "Weather unavailable",
        riverCFS: riverResult.status === "fulfilled" ? riverResult.value : "River flow unavailable",
      };
      setActiveTrip(nextTrip);
      setStatus("Conditions updated.");
    } finally {
      setIsUpdatingConditions(false);
    }
  }

  async function addTrackPoint() {
    if (!activeTrip) return;
    setStatus("Getting GPS point...");
    try {
      const position = await getCurrentPosition();
      const coords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
      };
      setActiveTrip({
        ...activeTrip,
        locationName: formatCoords(coords),
        coords,
        track: [...activeTrip.track, { ...coords, time: new Date().toISOString() }],
      });
      setStatus("GPS point added.");
    } catch (error) {
      setStatus(error.message || "Could not add GPS point.");
    }
  }

  function endTrip() {
    if (!activeTrip) return;
    const finished = { ...activeTrip, endTime: Date.now() };
    setTrips([finished, ...trips]);
    setActiveTrip(null);
    setStatus("Trip saved.");
  }

  async function addCatch(catchData) {
    if (!activeTrip) return;
    let location = activeTrip.coords || null;
    try {
      const position = await getCurrentPosition();
      location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
      };
    } catch {
      location = activeTrip.coords || null;
    }
    setActiveTrip({
      ...activeTrip,
      catches: [...activeTrip.catches, { ...catchData, location }],
      track: location ? [...activeTrip.track, { ...location, time: catchData.time, catchId: catchData.id }] : activeTrip.track,
    });
    setShowCatch(false);
    setStatus("Catch saved.");
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,.35),transparent_35%),linear-gradient(135deg,#020617,#042f2e,#020617)] text-slate-50">
      <div className="mx-auto flex min-h-screen max-w-md flex-col pb-24">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-black/30 px-4 py-4 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-teal-200">DriftLog</p>
              <h1 className="text-2xl font-bold">Current & Cast</h1>
            </div>
            <div className="rounded-2xl bg-teal-300/15 p-3 text-teal-200">
              <Fish size={28} />
            </div>
          </div>
        </header>

        <main className="flex-1 p-4">
          {tab === "home" && (
            <Home
              activeTrip={activeTrip}
              startTrip={startTrip}
              endTrip={endTrip}
              setShowCatch={setShowCatch}
              now={now}
              trips={trips}
              allCatches={allCatches}
              status={status}
              refreshConditions={refreshConditions}
              addTrackPoint={addTrackPoint}
              isUpdatingConditions={isUpdatingConditions}
            />
          )}
          {tab === "trips" && <Trips trips={trips} />}
          {tab === "library" && <LibraryView flies={flies} setFlies={setFlies} techniques={techniques} setTechniques={setTechniques} />}
          {tab === "stats" && <Stats trips={trips} allCatches={allCatches} bestFly={bestFly} bestTechnique={bestTechnique} />}
        </main>

        <nav className="fixed bottom-0 left-1/2 z-30 grid w-full max-w-md -translate-x-1/2 grid-cols-4 border-t border-white/10 bg-black/70 px-2 py-2 backdrop-blur-xl">
          <NavButton active={tab === "home"} onClick={() => setTab("home")} icon={<MapPin size={20} />} label="Home" />
          <NavButton active={tab === "trips"} onClick={() => setTab("trips")} icon={<Waves size={20} />} label="Trips" />
          <NavButton active={tab === "library"} onClick={() => setTab("library")} icon={<Library size={20} />} label="Library" />
          <NavButton active={tab === "stats"} onClick={() => setTab("stats")} icon={<BarChart3 size={20} />} label="Stats" />
        </nav>
      </div>

      {showCatch && <AddCatchModal flies={flies} techniques={techniques} onSave={addCatch} onClose={() => setShowCatch(false)} />}
    </div>
  );
}

function Home({ activeTrip, startTrip, endTrip, setShowCatch, now, trips, allCatches, status, refreshConditions, addTrackPoint, isUpdatingConditions }) {
  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="bg-gradient-to-br from-teal-400/25 to-white/5">
          <h2 className="text-2xl font-bold">Fishing log built for the water</h2>
          <p className="mt-2 text-sm text-slate-300">Track trips, catches, flies, lures, techniques, GPS points, weather, moon phase, river CFS, and patterns.</p>
        </Card>
      </motion.div>

      {!activeTrip ? (
        <Card>
          <h3 className="text-xl font-bold">Ready to fish?</h3>
          <p className="mt-2 text-sm text-slate-300">Start a trip to capture your location and pull live conditions.</p>
          <button onClick={startTrip} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-teal-300 px-4 py-4 font-bold text-slate-950 shadow-lg shadow-teal-950/40">
            <Navigation size={20} /> Start Trip
          </button>
        </Card>
      ) : (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-300">Active Trip</p>
              <p className="text-4xl font-black text-teal-200">{formatDuration(now - activeTrip.startTime)}</p>
            </div>
            <Timer className="text-teal-200" size={36} />
          </div>

          <div className="mt-4 rounded-2xl border border-teal-300/20 bg-black/30 p-4">
            <div className="flex items-center gap-3">
              <MapPin className="text-teal-200" size={34} />
              <div className="min-w-0">
                <p className="font-semibold">{activeTrip.locationName}</p>
                <p className="text-xs text-slate-400">{activeTrip.track.length} GPS points captured</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={addTrackPoint} className="flex items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-3 text-sm font-semibold text-slate-100">
                <LocateFixed size={17} /> Add GPS
              </button>
              <button onClick={() => refreshConditions()} disabled={isUpdatingConditions} className="flex items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-3 text-sm font-semibold text-slate-100 disabled:opacity-60">
                <RefreshCw size={17} className={isUpdatingConditions ? "animate-spin" : ""} /> Refresh
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            <InfoRow icon={<CloudSun size={18} />} label="Weather" value={activeTrip.weather} />
            <InfoRow icon={<Moon size={18} />} label="Moon" value={activeTrip.moon} />
            <InfoRow icon={<Waves size={18} />} label="River Flow" value={activeTrip.riverCFS} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button onClick={() => setShowCatch(true)} className="rounded-2xl bg-teal-300 px-4 py-4 font-bold text-slate-950"><Plus className="mx-auto mb-1" />Add Catch</button>
            <button onClick={endTrip} className="rounded-2xl bg-red-500/90 px-4 py-4 font-bold text-white">End Trip</button>
          </div>
        </Card>
      )}

      {status && <p className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-slate-300">{status}</p>}

      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="Trips" value={trips.length} />
        <MiniStat label="Fish" value={allCatches.length} />
        <MiniStat label="Data" value={trips.length ? "Building" : "None"} />
      </div>
    </div>
  );
}

function Trips({ trips }) {
  const [query, setQuery] = useState("");
  const filtered = trips.filter((t) => JSON.stringify(t).toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-3 text-slate-400" size={18} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search trips, species, flies..." className="w-full rounded-2xl border border-white/10 bg-black/30 py-3 pl-10 pr-3 outline-none focus:border-teal-300" />
      </div>
      {filtered.length === 0 ? <Empty title="No trips yet" text="Start and end a trip from the Home tab." /> : filtered.map((trip) => <TripCard key={trip.id} trip={trip} />)}
    </div>
  );
}

function TripCard({ trip }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">{trip.title}</h3>
          <p className="text-sm text-slate-300">{new Date(trip.date).toLocaleString()}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill>{trip.catches.length} catches</Pill>
            <Pill>{trip.waterClarity}</Pill>
            <Pill>{trip.waterType}</Pill>
            <Pill>{trip.track?.length || 0} GPS</Pill>
          </div>
        </div>
        <Share2 className="text-teal-200" />
      </div>
      <div className="mt-4 grid gap-2 text-sm text-slate-300">
        <InfoRow icon={<CloudSun size={18} />} label="Weather" value={trip.weather} />
        <InfoRow icon={<Waves size={18} />} label="River Flow" value={trip.riverCFS} />
      </div>
      <div className="mt-4 space-y-2">
        {trip.catches.map((c) => (
          <div key={c.id} className="rounded-xl bg-black/25 p-3 text-sm">
            <div>
              <b>{c.species}</b> on {c.flyOrLure} - {c.technique}
            </div>
            {c.location && <p className="mt-1 text-xs text-slate-400">{formatCoords(c.location)}</p>}
            {c.photo && <img src={c.photo.url} alt={c.photo.name || "Catch"} className="mt-3 h-36 w-full rounded-xl object-cover" />}
          </div>
        ))}
      </div>
    </Card>
  );
}

function LibraryView({ flies, setFlies, techniques, setTechniques }) {
  const [flyName, setFlyName] = useState("");
  const [techniqueName, setTechniqueName] = useState("");

  function addFly() {
    if (!flyName.trim()) return;
    setFlies([...flies, { id: uid(), name: flyName, type: "Custom", color: "", size: "", target: "" }]);
    setFlyName("");
  }

  function addTechnique() {
    if (!techniqueName.trim()) return;
    setTechniques([...techniques, techniqueName]);
    setTechniqueName("");
  }

  function clearSavedData() {
    if (!window.confirm("Clear all saved DriftLog data on this device?")) return;
    localStorage.removeItem(storageKey);
    window.location.reload();
  }

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-xl font-bold">Fly & Lure Library</h3>
        <div className="mt-3 flex gap-2">
          <input value={flyName} onChange={(e) => setFlyName(e.target.value)} placeholder="Add fly or lure" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-3 outline-none focus:border-teal-300" />
          <button onClick={addFly} className="rounded-xl bg-teal-300 px-4 font-bold text-slate-950">Add</button>
        </div>
        <div className="mt-4 space-y-2">
          {flies.map((f) => (
            <div key={f.id} className="rounded-xl bg-black/25 p-3">
              <p className="font-bold">{f.name}</p>
              <p className="text-sm text-slate-300">{f.type} - {f.color} - {f.size}</p>
              <p className="text-xs text-teal-200">{f.target}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="text-xl font-bold">Technique Library</h3>
        <div className="mt-3 flex gap-2">
          <input value={techniqueName} onChange={(e) => setTechniqueName(e.target.value)} placeholder="Add technique" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-3 outline-none focus:border-teal-300" />
          <button onClick={addTechnique} className="rounded-xl bg-teal-300 px-4 font-bold text-slate-950">Add</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {techniques.map((t) => <Pill key={t}>{t}</Pill>)}
        </div>
      </Card>

      <Card>
        <h3 className="text-xl font-bold">Device Storage</h3>
        <p className="mt-2 text-sm text-slate-300">Trips, catches, libraries, and photos are saved on this device.</p>
        <button onClick={clearSavedData} className="mt-4 w-full rounded-xl border border-red-300/30 bg-red-500/15 px-4 py-3 font-bold text-red-100">Clear Saved Data</button>
      </Card>
    </div>
  );
}

function Stats({ trips, allCatches, bestFly, bestTechnique }) {
  const species = mostCommon(allCatches.map((c) => c.species)) || "Not enough data";
  const catchesByTrip = trips.map((trip) => ({
    label: new Date(trip.date).toLocaleDateString(),
    value: trip.catches?.length || 0,
  }));
  const riverRanges = trips.map((trip) => bucketRiverFlow(trip.riverCFS));
  const weatherPatterns = trips.map((trip) => weatherPattern(trip.weather));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <MiniStat label="Trips" value={trips.length} />
        <MiniStat label="Fish" value={allCatches.length} />
      </div>
      <Card>
        <h3 className="text-xl font-bold">Pattern Snapshot</h3>
        <div className="mt-3 grid gap-2 text-sm">
          <InfoRow icon={<Fish size={18} />} label="Top Species" value={species} />
          <InfoRow icon={<Library size={18} />} label="Best Fly/Lure" value={bestFly} />
          <InfoRow icon={<Waves size={18} />} label="Best Technique" value={bestTechnique} />
        </div>
      </Card>
      <BarChart title="Species" rows={countRows(allCatches.map((c) => c.species))} emptyText="Log catches to see which species show up most." />
      <BarChart title="Fly/Lure" rows={countRows(allCatches.map((c) => c.flyOrLure))} emptyText="Add catches with flies or lures to compare what produces." />
      <BarChart title="Technique" rows={countRows(allCatches.map((c) => c.technique))} emptyText="Save techniques with catches to spot presentation patterns." />
      <BarChart title="Water Clarity" rows={countRows(allCatches.map((c) => c.waterClarity))} emptyText="Catch water clarity will appear here." />
      <BarChart title="Moon Phase" rows={countRows(trips.map((trip) => trip.moon))} emptyText="End trips to compare catches by moon phase." />
      <BarChart title="Weather" rows={countRows(weatherPatterns)} emptyText="Live weather conditions will appear after trips are saved." />
      <BarChart title="River Flow" rows={countRows(riverRanges)} emptyText="River flow ranges will appear after USGS data is saved." />
      <BarChart title="Catches By Trip" rows={catchesByTrip.filter((row) => row.value > 0)} emptyText="Trips with catches will show as bars here." />
      <Card>
        <h3 className="text-xl font-bold">Pattern Finder</h3>
        <p className="mt-2 text-sm text-slate-300">The strongest bars show what has produced most often so far. As the log grows, these charts make it easier to compare fish by fly, presentation, clarity, moon, weather, and river flow.</p>
      </Card>
    </div>
  );
}

function BarChart({ title, rows, emptyText }) {
  const max = Math.max(...rows.map((row) => row.value), 0);

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold">{title}</h3>
        <BarChart3 className="shrink-0 text-teal-200" size={20} />
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl bg-black/25 p-3 text-sm text-slate-300">{emptyText}</p>
      ) : (
        <div className="space-y-3">
          {rows.slice(0, 6).map((row) => (
            <div key={row.label} className="grid gap-1">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-slate-100">{row.label}</span>
                <span className="shrink-0 font-bold text-teal-200">{row.value}</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-black/35">
                <div className="h-full rounded-full bg-teal-300" style={{ width: `${Math.max(8, (row.value / max) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function AddCatchModal({ flies, techniques, onSave, onClose }) {
  const [species, setSpecies] = useState("Guadalupe Bass");
  const [flyOrLure, setFlyOrLure] = useState(flies[0]?.name || "");
  const [technique, setTechnique] = useState(techniques[0] || "");
  const [clarity, setClarity] = useState("Slightly stained");
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState(null);

  async function selectPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const url = await fileToDataUrl(file);
      setPhoto({
        name: file.name,
        type: file.type,
        size: file.size,
        url,
      });
    } catch {
      setPhoto(null);
    }
  }

  function save() {
    onSave({ id: uid(), species, flyOrLure, technique, waterClarity: clarity, notes, time: new Date().toISOString(), photo });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/70 p-3">
      <div className="mx-auto max-h-[92vh] w-full max-w-md overflow-y-auto rounded-3xl border border-teal-300/20 bg-slate-950 p-4 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Add Catch</h2>
          <button onClick={onClose} className="rounded-full bg-white/10 px-3 py-1">Close</button>
        </div>
        <div className="space-y-3">
          <Select label="Species" value={species} setValue={setSpecies} options={speciesOptions} />
          <Select label="Fly/Lure" value={flyOrLure} setValue={setFlyOrLure} options={flies.map((f) => f.name)} />
          <Select label="Technique" value={technique} setValue={setTechnique} options={techniques} />
          <Select label="Water Clarity" value={clarity} setValue={setClarity} options={clarityOptions} />
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="h-24 w-full rounded-2xl border border-white/10 bg-black/30 p-3 outline-none focus:border-teal-300" />
          <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-slate-200">
            <Camera size={18} /> {photo ? photo.name : "Attach Photo"}
            <input type="file" accept="image/*" capture="environment" onChange={selectPhoto} className="sr-only" />
          </label>
          {photo && <img src={photo.url} alt={photo.name || "Catch preview"} className="h-48 w-full rounded-2xl object-cover" />}
          <button onClick={save} className="w-full rounded-2xl bg-teal-300 px-4 py-4 font-bold text-slate-950">Save Catch</button>
        </div>
      </div>
    </div>
  );
}

function Select({ label, value, setValue, options }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-400">{label}</span>
      <select value={value} onChange={(e) => setValue(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-black/30 p-3 outline-none focus:border-teal-300">
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </label>
  );
}

function InfoRow({ icon, label, value }) {
  return <div className="flex items-center gap-3 rounded-xl bg-black/25 p-3 text-sm"><span className="text-teal-200">{icon}</span><div className="min-w-0"><p className="text-xs text-slate-400">{label}</p><p className="break-words">{value}</p></div></div>;
}

function MiniStat({ label, value, large }) {
  return <Card className={large ? "" : "p-3"}><p className="text-xs text-slate-400">{label}</p><p className={large ? "text-3xl font-black text-teal-200" : "text-xl font-bold text-teal-200"}>{value}</p></Card>;
}

function Empty({ title, text }) {
  return <Card className="text-center"><Fish className="mx-auto text-teal-200" size={36} /><h3 className="mt-3 text-xl font-bold">{title}</h3><p className="mt-1 text-sm text-slate-300">{text}</p></Card>;
}

function NavButton({ active, onClick, icon, label }) {
  return <button onClick={onClick} className={cx("flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-xs", active ? "bg-teal-300 text-slate-950" : "text-slate-300")}>{icon}<span>{label}</span></button>;
}

function mostCommon(items) {
  const counts = items.reduce((acc, item) => {
    if (!item) return acc;
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
}

function countRows(items) {
  const counts = items.reduce((acc, item) => {
    if (!item || item === "Manual entry needed" || item.includes("unavailable")) return acc;
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function weatherPattern(weather) {
  if (!weather || weather.includes("unavailable") || weather === "Manual entry needed") return "";
  const [, condition = weather] = weather.split(", ");
  return condition;
}

function bucketRiverFlow(riverCFS) {
  if (!riverCFS || riverCFS.includes("unavailable") || riverCFS === "Manual entry needed") return "";
  const match = riverCFS.match(/[\d,]+(?:\.\d+)?(?=\s*CFS)/i);
  if (!match) return "";
  const cfs = Number(match[0].replaceAll(",", ""));
  if (!Number.isFinite(cfs)) return "";
  if (cfs < 100) return "Under 100 CFS";
  if (cfs < 250) return "100-249 CFS";
  if (cfs < 500) return "250-499 CFS";
  if (cfs < 1000) return "500-999 CFS";
  if (cfs < 2500) return "1,000-2,499 CFS";
  return "2,500+ CFS";
}
