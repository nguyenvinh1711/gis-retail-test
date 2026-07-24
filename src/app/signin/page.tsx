import { signInAction } from "@/app/actions";

export default function SignInPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <form
        action={signInAction}
        className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h1 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Sign in (demo)
        </h1>
        <p className="mb-4 text-sm text-zinc-500">
          This is a mock sign-in for the demo. No real auth — values are stored in a cookie.
        </p>
        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-zinc-700 dark:text-zinc-300">Email</span>
          <input
            name="user"
            type="email"
            defaultValue="demo@gis-retail.test"
            className="w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>
        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-zinc-700 dark:text-zinc-300">Tenant</span>
          <input
            name="tenant"
            type="text"
            defaultValue="Demo Tenant"
            className="w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800"
          />
        </label>
        <button
          type="submit"
          className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
