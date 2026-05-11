import { NavLink, useLocation } from "react-router-dom";
import { Zap, Sun, Moon, Trophy, TrendingUp, Cloud, Wallet } from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Category definitions
// ---------------------------------------------------------------------------

const CATEGORIES = [
  {
    key: "crypto",
    label: "Crypto",
    href: "/app",
    icon: <TrendingUp className="h-3.5 w-3.5" />,
    routes: ["/app", "/app/history", "/app/guide", "/app/stats"],
    subNav: [] as { label: string; href: string }[],
    activeClass: "chip-tint-orange text-orange-300",
  },
  {
    key: "sports",
    label: "Sports",
    href: "/app/sports",
    icon: <Trophy className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400/20" />,
    routes: ["/app/sports"],
    subNav: [] as { label: string; href: string }[],
    activeClass: "chip-tint-yellow text-yellow-300",
  },
  {
    key: "weather",
    label: "Weather",
    href: "/app/weather",
    icon: <Cloud className="h-3.5 w-3.5 text-cyan-400" />,
    routes: ["/app/weather"],
    subNav: [] as { label: string; href: string }[],
    activeClass: "chip-tint-cyan text-cyan-300",
  },
];

function isCategoryActive(cat: (typeof CATEGORIES)[0], pathname: string) {
  return cat.routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

// ---------------------------------------------------------------------------
// Category bar + sub-nav
// ---------------------------------------------------------------------------

function CategoryNav() {
  const { pathname } = useLocation();

  const activeCategory = CATEGORIES.find((c) => isCategoryActive(c, pathname)) ?? CATEGORIES[0];

  return (
    <div className="sticky top-14 z-40 w-full border-b border-border/40 bg-background/90 shadow-[0_1px_0_rgba(255,255,255,0.03)] backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 lg:px-8">

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
                    ? cat.activeClass
                    : "bg-background/70 text-muted-foreground border-border/50 hover:border-border hover:bg-muted/40 hover:text-foreground"
                }`}
              >
                {cat.icon}
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
  const { pathname } = useLocation();
  const isLanding = pathname === "/";
  const myBetsActive = pathname.startsWith("/app/my-bets") || pathname.startsWith("/my-bets");

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground overflow-x-hidden selection:bg-primary selection:text-primary-foreground">

      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/90 shadow-[0_1px_0_rgba(255,255,255,0.03)] backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="px-3 sm:px-6 lg:px-8 flex h-14 items-center justify-between max-w-6xl mx-auto w-full">

          <NavLink to="/" className="flex items-center gap-1.5 font-mono font-bold tracking-tight shrink-0">
            <Zap className="h-5 w-5 text-yellow-400 fill-yellow-400 shrink-0" />
            <span className="text-sm sm:text-base">
              Predictions With <span className="text-yellow-400">SATS</span>
            </span>
          </NavLink>

          <div className="flex items-center gap-2 shrink-0">
            {isLanding ? (
              <NavLink
                to="/app"
                className="hidden sm:flex items-center gap-1.5 rounded-full border border-yellow-400/50 bg-yellow-400/15 px-3 py-1.5 text-[11px] font-semibold font-mono tracking-wide text-yellow-300 transition-all hover:bg-yellow-400/20"
              >
                <Zap className="h-3.5 w-3.5 text-yellow-400" />
                <span>Open app</span>
              </NavLink>
            ) : (
              <NavLink
                to="/app/my-bets"
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold font-mono tracking-wide transition-all ${
                  myBetsActive
                    ? "chip-tint-emerald text-emerald-300"
                    : "bg-background/70 text-muted-foreground border-border/50 hover:border-border hover:bg-muted/40 hover:text-foreground"
                }`}
              >
                <Wallet className="h-3.5 w-3.5 text-emerald-400" />
                <span>My bets</span>
              </NavLink>
            )}

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
        </div>
      </header>

      {/* Category + sub-nav */}
      {!isLanding ? <CategoryNav /> : null}

      <main
        className="flex-1 px-3 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8 max-w-6xl mx-auto w-full"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        {children}
      </main>
    </div>
  );
}
