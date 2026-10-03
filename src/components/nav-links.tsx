"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/races", label: "Races" },
  { href: "/standings", label: "Standings" },
  { href: "/drivers", label: "Drivers" },
];

/**
 * The nav bar's link list, split out from NavBar as its own client
 * component so it can read the current path for active-link highlighting —
 * NavBar itself stays a server component so its "Next Race" DB lookup runs
 * server-side rather than as a client fetch.
 */
export function NavLinks() {
  const pathname = usePathname();

  return (
    <>
      {LINKS.map(({ href, label }) => {
        // "/" matches exactly (otherwise every route would highlight it);
        // every other link also matches its own subpaths, e.g. "/drivers"
        // stays highlighted while viewing "/driver/44".
        const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={isActive ? "text-[#f2f3f5]" : "text-[#a3a9b8] hover:text-[#f2f3f5]"}
          >
            {label}
          </Link>
        );
      })}
    </>
  );
}
