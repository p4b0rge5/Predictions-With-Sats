import { NavLink, useLocation } from "react-router-dom";
import { Activity, History, Zap, Sun, Moon, HelpCircle, Trophy, Bitcoin } from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { Button } from "@/components/ui/button";

const CATEGORIES = [
  { label: "Crypto", href: "/", icon: "₿", color: "text-yellow-400", match: ["/", "/history", "/stats"] },
  { label: "Sports", href: "/sports", icon: "⚽", color: "text-green-400", match: ["/sports"] },
];

function CategoryBar() {
  const { pathname } = useLocation();

  const isActive = (cat: (typeof CATEGORIES)[0]) => {
    if (cat.href === "/") return pathname === "/" || pathname === "/history" || pathname === "/stats";
    return pathname.startsWith(cat.href);
  };

  return (
    <div className="sticky top-14 z-40 w-full bg-background/95 backdrop-blur border-b border-border/40 supports-[backdrop-filter]:bg-background/60">
      <div className="max-w-5xl mx-auto px-3 sm:px-6">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-2">
          {CATEGORIES.map((cat) => {
            const active = isActive(cat);
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
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { theme, toggleTheme } = useTheme();
  const { pathname } = useLocation();

  const navLinks = [
    { href: "/", label: "Live", icon: Activity },
    { href: "/history", label: "History", icon: History },
    { href: "/sports", label: "Sports", icon: Trophy },
    { href: "/guide", label: "Guide", icon: HelpCircle },
  ];

  const showCategoryBar = !pathname.startsWith("/guide") && !pathname.startsWith("/history");

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground overflow-x-hidden selection:bg-primary selection:text-primary-foreground">
      {/* ── Main header ── */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-3 sm:px-6 flex h-14 items-center justify-between max-w-5xl mx-auto w-full">

          {/* Logo */}
          <div className="flex items-center gap-1.5 font-mono font-bold tracking-tight shrink-0">
            <Zap className="h-5 w-5 text-yellow-400 fill-yellow-400 shrink-0" />
            <span className="text-sm sm:text-base">
              Prediction With <span className="text-yellow-400">SATS</span>
            </span>
          </div>

          {/* Nav + Theme toggle */}
          <div className="flex items-center gap-1">
            <nav className="flex items-center gap-0.5">
              {navLinks.map(({ href, label, icon: Icon }) => (
                <NavLink
                  key={href}
                  to={href}
                  end={href === "/"}
                  className={({ isActive }) =>
                    `flex items-center gap-1 px-2 sm:px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-colors ${
                      isActive
                        ? "text-yellow-400 bg-yellow-400/10"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`
                  }
                >
                  <Icon className={`h-4 w-4 shrink-0 ${href === "/" ? "text-green-400" : ""}`} />
                  <span className="hidden min-[400px]:inline">{label}</span>
                </NavLink>
              ))}
            </nav>

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

      {/* ── Category bar (below header, sticky) ── */}
      {showCategoryBar && <CategoryBar />}

      <main
        className="flex-1 px-3 sm:px-6 py-4 sm:py-6 max-w-5xl mx-auto w-full"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        {children}
      </main>
    </div>
  );
}
