// Geocode sample_datas/Supermarket.xlsx using OSM Nominatim.
// - Respects Nominatim usage policy: <=1 req/sec, User-Agent identifier.
// - Caches results in scripts/cache/geocode-cache.json so re-runs are fast.
// - Writes public/data/supermarkets-real.geojson (does NOT touch supermarkets.geojson).
// - Rows that fail to geocode fall back to a province centroid + jitter so they still appear.

import xlsx from "xlsx";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "gis-retail-demo/0.1 (contact: tidus2102@gmail.com)";
const RATE_MS = 1100;

const cachePath = resolve(__dirname, "cache/geocode-cache.json");
mkdirSync(dirname(cachePath), { recursive: true });
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};

// Same centroid table as build-supermarkets-geojson.mjs (kept in sync intentionally).
const centroids = {
  "Ha Noi City": [105.8342, 21.0278],
  "Ho Chi Minh City": [106.6297, 10.8231],
  "Tay Ninh Province": [106.0986, 11.3676],
  "Thanh Hoa Province": [105.7852, 19.806],
  "Bac Ninh Province": [106.0763, 21.1861],
  "Khanh Hoa Province": [109.1967, 12.2585],
  "Binh Duong Province": [106.6519, 11.3254],
  "Hai Phong City": [106.6881, 20.8449],
  "Quang Ninh Province": [107.2925, 21.0064],
  "Dong Thap Province": [105.6882, 10.4938],
  "Can Tho City": [105.7469, 10.0452],
  "Hung Yen Province": [106.0517, 20.852],
  "An Giang Province": [105.1259, 10.5216],
  "Hai Duong Province": [106.3146, 20.9373],
  "Kien Giang Province": [105.1259, 10.0125],
  "Tra Vinh Province": [106.3452, 9.9477],
  "Long An Province": [106.4081, 10.6957],
  "Dak Lak Province": [108.0378, 12.6667],
  "Ba Ria - Vung Tau Province": [107.2192, 10.5417],
  "Tien Giang Province": [106.342, 10.4493],
  "Hau Giang Province": [105.6413, 9.7579],
  "Gia Lai Province": [108.0, 13.8079],
  "Phu Tho Province": [105.2045, 21.3989],
  "Binh Dinh Province": [109.2196, 13.7757],
  "Da Nang City": [108.2022, 16.0544],
  "Vinh Phuc Province": [105.6049, 21.3609],
  "Dong Nai Province": [106.8243, 10.9447],
  "Quang Ngai Province": [108.8, 15.1213],
  "Binh Thuan Province": [108.1022, 10.9289],
  "Ha Tinh Province": [105.9057, 18.3559],
  "Thai Nguyen Province": [105.8442, 21.5942],
  "Ha Nam Province": [105.9221, 20.5835],
  "Nghe An Province": [104.92, 19.2342],
  "Soc Trang Province": [105.9739, 9.6037],
  "Vinh Long Province": [105.972, 10.253],
  "Kon Tum Province": [108.0166, 14.3499],
  "Lam Dong Province": [108.4583, 11.9404],
  "Binh Phuoc Province": [106.9038, 11.7512],
  "Thua Thien Hue Province": [107.5909, 16.4637],
  "Nam Dinh Province": [106.1683, 20.4388],
  "Ninh Thuan Province": [108.9908, 11.5675],
  "Bac Lieu Province": [105.7244, 9.294],
  "Ca Mau Province": [105.1524, 9.1768],
  "Quang Binh Province": [106.6213, 17.4684],
  "Phu Yen Province": [109.0929, 13.0882],
  "Ninh Binh Province": [105.9748, 20.2506],
  "Quang Tri Province": [107.1854, 16.7943],
  "Dak Nong Province": [107.6098, 12.2646],
  "Ben Tre Province": [106.3759, 10.2433],
  "Bac Giang Province": [106.197, 21.2731],
  "Quang Nam Province": [108.0191, 15.5394],
  "Son La Province": [103.9188, 21.3256],
  "Lai Chau Province": [103.4707, 22.3964],
  "Lang Son Province": [106.7619, 21.8537],
  "Yen Bai Province": [104.8716, 21.7229],
  "Thai Binh Province": [106.3366, 20.4463],
  "Tuyen Quang Province": [105.2281, 21.8233],
  "Hoa Binh Province": [105.3383, 20.8133],
  "Bac Kan Province": [105.8348, 22.1474],
};

function hashJitter(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = ((h >>> 0) % 10000) / 10000 - 0.5;
  const b = (((h >>> 0) >> 8) % 10000) / 10000 - 0.5;
  return [a * 0.12, b * 0.12];
}

function buildQueries(row) {
  const queries = [];
  if (row.Address && row.Address.trim()) {
    queries.push(`${row.Address.trim()}, ${row.City}, Vietnam`);
  }
  if (row.City) queries.push(`${row.City}, Vietnam`);
  return queries;
}

async function nominatim(q) {
  if (cache[q]) return cache[q];
  const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=jsonv2&limit=1&countrycodes=vn&addressdetails=1`;
  let result = null;
  try {
    const r = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en,vi" } });
    if (r.ok) {
      const arr = await r.json();
      if (arr && arr[0]) {
        result = { lat: Number(arr[0].lat), lon: Number(arr[0].lon), display: arr[0].display_name };
      }
    }
  } catch (e) {
    console.warn("  fetch error:", e.message);
  }
  cache[q] = result;
  return result;
}

function saveCache() {
  writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

(async () => {
  const wb = xlsx.readFile(resolve(root, "sample_datas/Supermarket.xlsx"));
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null });

  const features = [];
  let stats = { nominatim: 0, fallback: 0, skipped: 0 };
  let lastNet = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const queries = buildQueries(row);
    let hit = null;

    for (const q of queries) {
      if (cache[q] !== undefined) {
        hit = cache[q];
        if (hit) break;
      } else {
        // Network call — rate limit.
        const wait = Math.max(0, RATE_MS - (Date.now() - lastNet));
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastNet = Date.now();
        hit = await nominatim(q);
        if (i % 10 === 0) saveCache();
        if (hit) break;
      }
    }

    let coords, source;
    if (hit) {
      coords = [hit.lon, hit.lat];
      source = "nominatim";
      stats.nominatim++;
    } else if (centroids[row.City]) {
      const c = centroids[row.City];
      const [jx, jy] = hashJitter(row.Code || row.Name || row.Address || String(i));
      coords = [c[0] + jx, c[1] + jy];
      source = "centroid_fallback";
      stats.fallback++;
    } else {
      stats.skipped++;
      continue;
    }

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: coords },
      properties: {
        name: row.Name,
        brand: row.Brand,
        type: row.Type,
        city: row.City,
        address: row.Address,
        code: row.Code,
        geocode_source: source,
      },
    });

    if ((i + 1) % 20 === 0) {
      console.log(`  ${i + 1}/${rows.length} processed — nominatim=${stats.nominatim} fallback=${stats.fallback} skipped=${stats.skipped}`);
    }
  }

  saveCache();
  const out = { type: "FeatureCollection", features };
  const outPath = resolve(root, "public/data/supermarkets-real.geojson");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`\nWrote ${features.length} features to ${outPath}`);
  console.log(`  nominatim: ${stats.nominatim}, fallback: ${stats.fallback}, skipped: ${stats.skipped}`);
})();
