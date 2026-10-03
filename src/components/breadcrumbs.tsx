import Link from "next/link";

export type Breadcrumb = { label: string; href?: string };

/**
 * Shared breadcrumb trail, replacing four independently copy-pasted
 * "← back" links (driver, team, race analysis, prediction-review pages)
 * that all used the identical class string. The last crumb is the current
 * page and is never a link (no href); every earlier one should have one.
 */
export function Breadcrumbs({ items }: { items: Breadcrumb[] }) {
  return (
    <nav className="hud-mono flex flex-wrap items-center gap-1.5 text-xs uppercase tracking-widest">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-slate-700">/</span>}
            {item.href && !isLast ? (
              <Link href={item.href} className="text-red-500 hover:text-red-300">
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "text-slate-400" : "text-red-500"}>{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
