import { NavLink, useLocation } from "react-router-dom";
import { Zap, Sun, Moon } from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Category definitions
// ---------------------------------------------------------------------------

const CATEGORIES = [
  {
    label: "Crypto",
    href: "/",
    icon: "₿",
    routes: ["/", "/history", "/guide", "/stats"],
    subNav: [
      { label: "History", href: "/history" },
      { label: "Guide", href: "/guide" },
    ],
  },
  {
    label: "Sports",
    href: "/sports",
    icon: "⚽",
    routes: ["/sports"],
    subNav: [] as { label: string; href: string }[],
  },
];

function isCategoryActive(cat: (typeof CATEGORIES)[0], pathname: string) {
  if (cat.href === "/") {
    return pathname === "/" || cat.routes.some((r) => r !== "/" && pathname.startsWith(r));
  }
  return pathname.startsWith(cat.href);
}

// ---------------------------------------------------------------------------
// Category bar + sub-nav
// ---------------------------------------------------------------------------

function CategoryNav() {
  const { pathname } = useLocation();

  const activeCategory = CATEGORIES.find((c) => isCategoryActive(c, pathname)) ?? CATEGORIES[0];

  return (
    <div className="sticky top-14 z-40 w-full bg-background/95 backdrop-blur border-b border-border/40 supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-5xl mx-auto px-3 sm:px-6">

        {/* Category chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-2 pb-1.5">
          {CATEGORIES.map((cat) => {
            const active = isCategoryActive(cat, pathname);
            return (
              <NavLink
                key={cat.href}
                to={cat.href}
                end={cat.href === "/"}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-mono tracking-wide whitespace-nowrap transition-all shrink-0 border ${
                  active
                    ? "bg-foreground text-background border-foreground"
                    : "bg-transparent text-muted-foreground border-border/40 hover:border-border hover:text-foreground"
                }`}
              >
                <span className="text-sm leading-none">{cat.icon}</span>
                {cat.label}
              </NavLink>
            );
          })}
        </div>

        {/* Sub-nav — only when the active category has sub-items */}
        {activeCategory.subNav.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-2">
            {activeCategory.subNav.map((sub) => (
              <NavLink
                key={sub.href}
                to={sub.href}
                className={({ isActive }) =>
                  `px-2.5 py-1 rounded-md text-[11px] font-mono font-medium whitespace-nowrap transition-colors border ${
                    isActive
                      ? "text-foreground border-border bg-muted/60"
                      : "text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/30"
                  }`
                }
              >
                {sub.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Layout({ children }: { children: React.ReactNode }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground overflow-x-hidden selection:bg-primary selection:text-primary-foreground">

      {/* ── Header — logo + theme toggle only ── */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-3 sm:px-6 flex h-14 items-center justify-between max-w-5xl mx-auto w-full">

          <NavLink to="/" className="flex items-center gap-1.5 font-mono font-bold tracking-tight shrink-0">
            <Zap className="h-5 w-5 text-yellow-400 fill-yellow-400 shrink-0" />
            <span className="text-sm sm:text-base">
              Prediction With <span className="text-yellow-400">SATS</span>
            </span>
          </NavLink>

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* ── Category + sub-nav ── */}
      <CategoryNav />

      <main
        className="flex-1 px-3 sm:px-6 py-4 sm:py-6 max-w-5xl mx-auto w-full"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        {children}
      </main>
    </div>
  );
}
