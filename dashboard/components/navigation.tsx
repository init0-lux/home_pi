import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Control", icon: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 mb-1">
      <path d="M21 11V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h6v-2H5V5h14v6h2zM19 15v8l3-3-3-3v8"/>
    </svg>
  )},
  { href: "/provision", label: "Admin", icon: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 mb-0.5">
      <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
    </svg>
  )},
  { href: "/chat", label: "Chat", icon: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 mb-1">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
    </svg>
  )},
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="absolute w-full bottom-0 flex-none flex justify-around items-center px-4 py-4 bg-[#1c1b1b]/80 backdrop-blur-2xl border-t border-white/5 rounded-t-2xl shadow-[0_-10px_30px_rgba(0,0,0,0.5)] z-50">
      {items.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center justify-center transition-all duration-300 active:scale-95 ${
              active
                ? "text-primary-container bg-[#353534]/50 rounded-full px-5 py-2 active-nav-glow"
                : "text-neutral-500 opacity-60 hover:text-neutral-200"
            }`}
          >
            {item.icon}
            <span className="text-[9px] uppercase tracking-widest font-semibold">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
