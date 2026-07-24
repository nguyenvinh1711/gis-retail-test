import { cookies } from "next/headers";

const COOKIE_NAME = "gis_session";

export type Session = {
  user: string;
  tenant: string;
  entitlements: string[]; // layer ids the tenant has purchased
};

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as Session;
  } catch {
    return null;
  }
}

export async function setSession(session: Session): Promise<void> {
  const store = await cookies();
  const encoded = Buffer.from(JSON.stringify(session), "utf8").toString("base64");
  store.set(COOKIE_NAME, encoded, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export function isEntitled(session: Session | null, layerId: string): boolean {
  return Boolean(session?.entitlements.includes(layerId));
}
