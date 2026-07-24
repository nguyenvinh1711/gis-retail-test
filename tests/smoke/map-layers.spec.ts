import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

const BASE_URL = "http://127.0.0.1:3000";
const LAYER_IDS = [
  "vn-provinces",
  "supermarkets",
  "hospitals",
  "supermarket-density",
  "hospital-coverage-gaps",
] as const;

type LayerId = (typeof LAYER_IDS)[number];
type Coordinate = [number, number];
type MapHashState = {
  center?: Coordinate;
  zoom?: number;
  visibility?: Record<string, { visible: boolean; opacity: number }>;
  options?: Record<string, Record<string, unknown>>;
  selection?: { layerId: string; featureId: string | number } | null;
};

type InteractiveTarget = {
  layerId: LayerId;
  coordinate: Coordinate;
  initialZoom: number;
  tooltip: string;
};

const SUPERMARKET = {
  layerId: "supermarkets",
  coordinate: [106.6418699, 10.7635526],
  initialZoom: 11,
  tooltip: "AEON Citimart Res Q.11",
  brand: "Aeon Citimart",
  city: "Ho Chi Minh City",
  address: "205 Lạc Long Quân, phường 3, Quận 11, TP.HCM",
  coordinatesText: "10.763553, 106.641870",
} satisfies InteractiveTarget & {
  brand: string;
  city: string;
  address: string;
  coordinatesText: string;
};

const HOSPITAL = {
  layerId: "hospitals",
  coordinate: [105.8035297, 21.0080088],
  initialZoom: 11,
  tooltip: "Trạm y tế Trung Hòa",
  facilityType: "Clinic",
  coordinatesText: "21.008009, 105.803530",
} satisfies InteractiveTarget & {
  facilityType: string;
  coordinatesText: string;
};

const PROVINCE = {
  layerId: "vn-provinces",
  coordinate: [105.17370249447461, 10.506123671929947],
  initialZoom: 4.5,
  tooltip: "An Giang",
} satisfies InteractiveTarget;

function mapUrl(
  targetLayer: LayerId,
  coordinate: Coordinate,
  zoom: number,
): string {
  const visibility = Object.fromEntries(
    LAYER_IDS.map((layerId) => [
      layerId,
      { visible: layerId === targetLayer, opacity: 0.85 },
    ]),
  );
  const state: MapHashState = {
    center: coordinate,
    zoom,
    visibility,
    options: {
      supermarkets: { cluster: false },
      hospitals: { cluster: false },
    },
  };
  const encoded = Buffer.from(
    encodeURIComponent(JSON.stringify(state)),
    "utf8",
  ).toString("base64");
  return `/map#${encoded}`;
}

async function readMapState(page: Page): Promise<MapHashState> {
  return page.evaluate(() => {
    const encoded = window.location.hash.replace(/^#/, "");
    return JSON.parse(decodeURIComponent(atob(encoded))) as MapHashState;
  });
}

async function openAtTarget(
  page: Page,
  target: Pick<
    InteractiveTarget,
    "layerId" | "coordinate" | "initialZoom"
  >,
): Promise<Locator> {
  await page.goto(
    mapUrl(target.layerId, target.coordinate, target.initialZoom),
  );

  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () => (await readMapState(page)).zoom)
    .toBeCloseTo(target.initialZoom, 1);
  return canvas;
}

async function mapCenter(canvas: Locator): Promise<Coordinate> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Map canvas does not have a bounding box");
  return [box.x + box.width / 2, box.y + box.height / 2];
}

async function zoomInAtTarget(
  page: Page,
  count = 2,
): Promise<number> {
  let zoom = (await readMapState(page)).zoom ?? 0;
  const zoomIn = page.locator(".maplibregl-ctrl-zoom-in");

  for (let i = 0; i < count; i += 1) {
    await zoomIn.click();
    const previousZoom = zoom;
    await expect
      .poll(async () => (await readMapState(page)).zoom ?? 0)
      .toBeGreaterThan(previousZoom + 0.5);
    zoom = (await readMapState(page)).zoom ?? previousZoom + 1;
  }

  return zoom;
}

async function clickTarget(page: Page, canvas: Locator): Promise<void> {
  const [x, y] = await mapCenter(canvas);
  await page.mouse.click(x, y);
}

async function expectInteractiveSelection(
  page: Page,
  layerId: LayerId,
  zoomBeforeClick: number,
): Promise<Locator> {
  const detailPanel = page.locator("aside");
  await expect(detailPanel).toHaveAttribute("aria-hidden", "false");
  await expect
    .poll(async () => (await readMapState(page)).selection?.layerId)
    .toBe(layerId);
  await expect
    .poll(async () => (await readMapState(page)).zoom ?? 0)
    .toBeGreaterThan(zoomBeforeClick + 0.5);
  return detailPanel;
}

async function grantPremiumLayers(context: BrowserContext): Promise<void> {
  const value = Buffer.from(
    JSON.stringify({
      user: "smoke@gis-retail.test",
      tenant: "Smoke Tests",
      entitlements: ["supermarket-density", "hospital-coverage-gaps"],
    }),
    "utf8",
  ).toString("base64");

  await context.addCookies([
    {
      name: "gis_session",
      value,
      url: BASE_URL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

async function expectVisualizationOnlyLayer(
  page: Page,
  context: BrowserContext,
  layerId: "supermarket-density" | "hospital-coverage-gaps",
  layerName: string,
): Promise<void> {
  await grantPremiumLayers(context);
  const canvas = await openAtTarget(page, {
    layerId,
    coordinate: SUPERMARKET.coordinate,
    initialZoom: SUPERMARKET.initialZoom,
  });

  const layerToggle = page.getByRole("checkbox", {
    name: new RegExp(`^${layerName}`),
  });
  await expect(layerToggle).toBeEnabled();
  await expect(layerToggle).toBeChecked();

  await zoomInAtTarget(page);
  await clickTarget(page, canvas);

  await expect
    .poll(async () => (await readMapState(page)).selection ?? null)
    .toBeNull();
  await expect(page.locator("aside")).toHaveAttribute("aria-hidden", "true");
}

test.describe("map layer data-point smoke scenarios", () => {
  test.setTimeout(45_000);

  test("targets an An Giang polygon and opens province analytics", async ({
    page,
  }) => {
    const canvas = await openAtTarget(page, PROVINCE);
    const zoomBeforeClick = await zoomInAtTarget(page);
    await clickTarget(page, canvas);

    const detailPanel = await expectInteractiveSelection(
      page,
      PROVINCE.layerId,
      zoomBeforeClick,
    );
    await expect(
      detailPanel.getByRole("heading", {
        name: PROVINCE.tooltip,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      detailPanel.getByText("Supermarkets in province", { exact: true }),
    ).toBeVisible();
    await expect(detailPanel.getByText(/^bbox: W /)).toBeVisible();
  });

  test("targets a supermarket and opens catchment details", async ({
    page,
  }) => {
    const canvas = await openAtTarget(page, SUPERMARKET);
    await zoomInAtTarget(page);
    const zoomBeforeClick = (await readMapState(page)).zoom ?? 0;
    await clickTarget(page, canvas);

    const detailPanel = await expectInteractiveSelection(
      page,
      SUPERMARKET.layerId,
      zoomBeforeClick,
    );
    await expect(
      detailPanel.getByRole("heading", {
        name: SUPERMARKET.tooltip,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      detailPanel.getByText(SUPERMARKET.brand, { exact: true }),
    ).toBeVisible();
    await expect(
      detailPanel.getByText(SUPERMARKET.address, { exact: true }),
    ).toBeVisible();
    await expect(
      detailPanel.getByText(SUPERMARKET.city, { exact: true }),
    ).toBeVisible();
    await expect(
      detailPanel.getByText(SUPERMARKET.coordinatesText, { exact: true }),
    ).toBeVisible();
    await expect(
      detailPanel.getByText("Competitors nearby", { exact: true }),
    ).toBeVisible();
  });

  test("targets a health facility and opens nearby-service details", async ({
    page,
  }) => {
    const canvas = await openAtTarget(page, HOSPITAL);
    await zoomInAtTarget(page);
    const zoomBeforeClick = (await readMapState(page)).zoom ?? 0;
    await clickTarget(page, canvas);

    const detailPanel = await expectInteractiveSelection(
      page,
      HOSPITAL.layerId,
      zoomBeforeClick,
    );
    await expect(
      detailPanel.getByRole("heading", {
        name: HOSPITAL.tooltip,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      detailPanel
        .getByText(HOSPITAL.facilityType, { exact: true })
        .first(),
    ).toBeVisible();
    await expect(
      detailPanel.getByText(HOSPITAL.coordinatesText, { exact: true }),
    ).toBeVisible();
    await expect(
      detailPanel.getByText("Other facilities nearby", { exact: true }),
    ).toBeVisible();
    await expect(
      detailPanel.getByText("Supermarkets nearby", { exact: true }),
    ).toBeVisible();
  });

  test("targets retail data under the premium density heatmap", async ({
    page,
    context,
  }) => {
    await expectVisualizationOnlyLayer(
      page,
      context,
      "supermarket-density",
      "Supermarket Density",
    );
  });

  test("targets retail data under the premium coverage-gap heatmap", async ({
    page,
    context,
  }) => {
    await expectVisualizationOnlyLayer(
      page,
      context,
      "hospital-coverage-gaps",
      "Hospital coverage gaps",
    );
  });
});
