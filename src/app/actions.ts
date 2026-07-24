"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearSession, getSession, setSession } from "@/lib/auth";
import { PREMIUM_LAYER_IDS } from "@/layers/metadata";

export async function signInAction(formData: FormData) {
  const user = (formData.get("user") as string | null) || "demo@gis-retail.test";
  const tenant = (formData.get("tenant") as string | null) || "Demo Tenant";
  await setSession({ user, tenant, entitlements: [] });
  redirect("/map");
}

export async function signOutAction() {
  await clearSession();
  redirect("/");
}

export async function buyLayerAction(formData: FormData) {
  const layerId = formData.get("layerId") as string;
  if (!PREMIUM_LAYER_IDS.has(layerId)) return;
  const session = await getSession();
  if (!session) redirect("/signin");
  if (!session.entitlements.includes(layerId)) {
    session.entitlements.push(layerId);
    await setSession(session);
  }
  revalidatePath("/dashboard");
  revalidatePath("/map");
}

export async function refundLayerAction(formData: FormData) {
  const layerId = formData.get("layerId") as string;
  const session = await getSession();
  if (!session) return;
  session.entitlements = session.entitlements.filter((id) => id !== layerId);
  await setSession(session);
  revalidatePath("/dashboard");
  revalidatePath("/map");
}
