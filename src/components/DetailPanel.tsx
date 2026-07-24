"use client";

import type { ReactNode } from "react";

type Props = {
  open: boolean;
  collapsed?: boolean;
  canBack?: boolean;
  canForward?: boolean;
  onClose: () => void;
  onToggleCollapse?: () => void;
  onBack?: () => void;
  onForward?: () => void;
  title?: string;
  children: ReactNode;
};

export default function DetailPanel({
  open,
  collapsed = false,
  canBack = false,
  canForward = false,
  onClose,
  onToggleCollapse,
  onBack,
  onForward,
  title,
  children,
}: Props) {
  const width = collapsed ? "w-12" : "w-[380px]";
  return (
    <aside
      className={`pointer-events-auto absolute top-0 right-0 bottom-0 z-20 ${width} max-w-[90vw] overflow-y-auto border-l border-zinc-200 bg-white shadow-xl transition-transform dark:border-zinc-800 dark:bg-zinc-950 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
      aria-hidden={!open}
    >
      <div className="sticky top-0 flex items-center justify-between gap-1 border-b border-zinc-200 bg-white/95 px-2 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        {!collapsed && (
          <div className="flex items-center gap-1">
            <button
              onClick={onBack}
              disabled={!canBack}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
              aria-label="Back"
              title="Back"
            >
              ←
            </button>
            <button
              onClick={onForward}
              disabled={!canForward}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-30 disabled:hover:bg-transparent dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
              aria-label="Forward"
              title="Forward"
            >
              →
            </button>
          </div>
        )}
        <h2 className={`flex-1 truncate px-1 text-xs font-semibold ${collapsed ? "text-center" : ""} text-zinc-600 dark:text-zinc-400`}>
          {collapsed ? "≡" : (title ?? "Feature details")}
        </h2>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            aria-label={collapsed ? "Expand panel" : "Collapse panel"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? "◂" : "▸"}
          </button>
        )}
        {!collapsed && (
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            aria-label="Close detail panel"
            title="Close"
          >
            ✕
          </button>
        )}
      </div>
      {!collapsed && <div className="p-4">{children}</div>}
    </aside>
  );
}
