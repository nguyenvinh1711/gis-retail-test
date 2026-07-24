import Link from "next/link";
import { redirect } from "next/navigation";
import { buyLayerAction, refundLayerAction } from "@/app/actions";
import { getSession } from "@/lib/auth";
import { LAYER_METADATA as LAYERS } from "@/layers/metadata";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/signin");

  const premium = LAYERS.filter((l) => l.visibility === "premium");
  const owned = new Set(session.entitlements);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {session.tenant}
      </h1>
      <p className="mt-1 text-sm text-zinc-500">Signed in as {session.user}</p>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Premium layers
        </h2>
        <ul className="space-y-3">
          {premium.map((l) => {
            const isOwned = owned.has(l.id);
            return (
              <li
                key={l.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div>
                  <div className="font-medium text-zinc-900 dark:text-zinc-50">{l.name}</div>
                  <div className="text-sm text-zinc-500">{l.description}</div>
                </div>
                {isOwned ? (
                  <form action={refundLayerAction}>
                    <input type="hidden" name="layerId" value={l.id} />
                    <button className="rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                      Remove access
                    </button>
                  </form>
                ) : (
                  <form action={buyLayerAction}>
                    <input type="hidden" name="layerId" value={l.id} />
                    <button className="rounded-md bg-amber-500 px-3 py-1 text-sm font-semibold text-white hover:bg-amber-600">
                      Buy access (mock)
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Public layers (included for everyone)
        </h2>
        <ul className="space-y-2 text-sm">
          {LAYERS.filter((l) => l.visibility === "public").map((l) => (
            <li key={l.id} className="rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <span className="font-medium">{l.name}</span>{" "}
              <span className="text-zinc-500">— {l.description}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-8">
        <Link
          href="/map"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Open the map →
        </Link>
      </div>
    </div>
  );
}
