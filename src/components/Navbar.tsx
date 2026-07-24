import Link from "next/link";
import { getSession } from "@/lib/auth";
import { signOutAction } from "@/app/actions";

export default async function Navbar() {
  const session = await getSession();
  return (
    <nav className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-6">
        <Link href="/" className="font-semibold text-zinc-900 dark:text-zinc-50">
          gis-retail
        </Link>
        <Link href="/map" className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50">
          Map
        </Link>
        <Link href="/dashboard" className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50">
          Dashboard
        </Link>
      </div>
      <div className="flex items-center gap-3">
        {session ? (
          <>
            <span className="text-zinc-600 dark:text-zinc-400">
              {session.tenant} · {session.user}
            </span>
            <form action={signOutAction}>
              <button className="rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
                Sign out
              </button>
            </form>
          </>
        ) : (
          <Link
            href="/signin"
            className="rounded-md bg-zinc-900 px-3 py-1 text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Sign in
          </Link>
        )}
      </div>
    </nav>
  );
}
