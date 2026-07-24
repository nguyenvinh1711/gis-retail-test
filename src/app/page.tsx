import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="max-w-2xl text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          gis-retail
        </h1>
        <p className="mt-4 text-lg text-zinc-600 dark:text-zinc-400">
          Multi-tenant GIS SaaS demo — map layers for retail intelligence. Public layers for
          everyone; premium layers gated by tenant entitlements.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link
            href="/map"
            className="rounded-md bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Open map
          </Link>
          <Link
            href="/signin"
            className="rounded-md border border-zinc-300 px-5 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Sign in
          </Link>
        </div>
        <p className="mt-6 text-xs text-zinc-500">
          Demo data: 377 supermarket locations + Vietnam province boundaries. Premium layer
          (supermarket density heatmap) unlocks via mock purchase on the dashboard.
        </p>
      </div>
    </div>
  );
}
