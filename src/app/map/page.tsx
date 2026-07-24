import MapView from "@/components/MapView";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function MapPage() {
  const session = await getSession();
  return <MapView entitlements={session?.entitlements ?? []} />;
}
