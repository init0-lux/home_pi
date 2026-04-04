"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Control" },
  { href: "/provision", label: "Provision" },
  { href: "/chat", label: "LLM Chat" },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-4 z-40 mx-auto mt-auto w-full max-w-md px-4 pb-4 md:static md:max-w-none md:px-0 md:pb-0">
      <div className="grid grid-cols-3 gap-2 rounded-[28px] border border-white/15 bg-slate-950/70 p-2 shadow-[0_24px_80px_rgba(15,23,36,0.45)] backdrop-blur-xl">
        {items.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              className={`rounded-2xl px-4 py-3 text-center text-sm font-semibold transition ${
                active
                  ? "bg-[linear-gradient(135deg,#f7c984,#f08f66)] text-slate-950"
                  : "text-slate-300 hover:bg-white/6 hover:text-white"
              }`}
              href={item.href}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
