// Build public/data/hospitals.geojson from OSM Overpass.
// Includes amenity=hospital|clinic|doctors|pharmacy across Vietnam.
// Optional enrichment from healthsites.io if HEALTHSITES_API_KEY env is set.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const UA = "gis-retail-demo/0.1 (contact: tidus2102@gmail.com)";

const cacheDir = resolve(__dirname, "cache");
mkdirSync(cacheDir, { recursive: true });
const overpassCachePath = resolve(cacheDir, "overpass-vn-health.json");
const healthsitesCachePath = resolve(cacheDir, "healthsites-vn.json");

const QUERY = `[out:json][timeout:90];
area["ISO3166-1"="VN"][admin_level=2]->.vn;
(
  node["amenity"~"^(hospital|clinic|doctors|pharmacy)$"](area.vn);
  way["amenity"~"^(hospital|clinic|doctors|pharmacy)$"](area.vn);
  relation["amenity"~"^(hospital|clinic|doctors|pharmacy)$"](area.vn);
);
out center tags;`;

async function fetchOverpass() {
  if (existsSync(overpassCachePath)) {
    console.log("Using cached Overpass response.");
    return JSON.parse(readFileSync(overpassCachePath, "utf8"));
  }
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      console.log(`Querying Overpass: ${url}`);
      const r = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(QUERY),
      });
      if (!r.ok) {
        console.warn(`  ${r.status} from ${url} — trying next mirror`);
        continue;
      }
      const json = await r.json();
      writeFileSync(overpassCachePath, JSON.stringify(json));
      console.log(`  cached ${json.elements?.length ?? 0} elements`);
      return json;
    } catch (e) {
      console.warn(`  fetch error from ${url}: ${e.message} — trying next`);
    }
  }
  throw new Error("All Overpass endpoints failed");
}

async function fetchHealthsites() {
  const key = process.env.HEALTHSITES_API_KEY;
  if (!key) return null;
  if (existsSync(healthsitesCachePath)) {
    return JSON.parse(readFileSync(healthsitesCachePath, "utf8"));
  }
  const out = [];
  let page = 1;
  while (true) {
    const url = `https://healthsites.io/api/v2/facilities/?api-key=${encodeURIComponent(key)}&country=Vietnam&page=${page}`;
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) {
      console.warn(`  healthsites.io page ${page} → ${r.status}; stopping`);
      break;
    }
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) break;
    out.push(...arr);
    page++;
    await new Promise((res) => setTimeout(res, 200));
  }
  writeFileSync(healthsitesCachePath, JSON.stringify(out));
  console.log(`healthsites.io: ${out.length} facilities cached`);
  return out;
}

function buildHealthsitesIndex(items) {
  const byOsm = new Map();
  if (!items) return byOsm;
  for (const it of items) {
    const osmId = it.osm_id ?? it.attributes?.osm_id;
    if (osmId != null) byOsm.set(String(osmId), it);
  }
  return byOsm;
}

function elementToFeature(el, hsByOsm) {
  const lng = el.type === "node" ? el.lon : el.center?.lon;
  const lat = el.type === "node" ? el.lat : el.center?.lat;
  if (lng == null || lat == null) return null;
  const tags = el.tags ?? {};
  const type = tags.amenity;
  const name = tags["name:en"] || tags.name || `Unnamed ${type}`;
  const props = {
    osm_id: `${el.type}/${el.id}`,
    name,
    type,
    brand: tags.brand,
    address: [tags["addr:housenumber"], tags["addr:street"], tags["addr:district"], tags["addr:city"]]
      .filter(Boolean).join(", ") || undefined,
    city: tags["addr:city"] || tags["addr:district"] || undefined,
    phone: tags.phone || tags["contact:phone"],
    website: tags.website || tags["contact:website"],
    operator: tags.operator,
    source: "osm",
  };
  // Strip undefined keys for compactness.
  for (const k of Object.keys(props)) if (props[k] === undefined) delete props[k];

  const hs = hsByOsm.get(String(el.id));
  if (hs) {
    props.ownership = hs.attributes?.ownership ?? hs.ownership;
    props.healthsites_type = hs.attributes?.amenity ?? hs.type;
    props.source = "osm+healthsites";
  }

  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: props,
  };
}

(async () => {
  const overpass = await fetchOverpass();
  const healthsites = await fetchHealthsites();
  const hsByOsm = buildHealthsitesIndex(healthsites);

  const features = [];
  const stats = { hospital: 0, clinic: 0, doctors: 0, pharmacy: 0, skipped: 0, enriched: 0 };
  for (const el of overpass.elements ?? []) {
    const f = elementToFeature(el, hsByOsm);
    if (!f) { stats.skipped++; continue; }
    features.push(f);
    stats[f.properties.type] = (stats[f.properties.type] ?? 0) + 1;
    if (f.properties.source === "osm+healthsites") stats.enriched++;
  }

  const out = { type: "FeatureCollection", features };
  const outPath = resolve(root, "public/data/hospitals.geojson");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out));

  console.log("");
  console.log(`Wrote ${features.length} features to ${outPath}`);
  console.log("  by type:", JSON.stringify({ hospital: stats.hospital, clinic: stats.clinic, doctors: stats.doctors, pharmacy: stats.pharmacy }));
  console.log(`  skipped: ${stats.skipped}, enriched via healthsites.io: ${stats.enriched}`);
})();
