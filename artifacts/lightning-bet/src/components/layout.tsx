import { NavLink } from "react-router-dom";
import { Activity, History, BarChart3, Zap, Sun, Moon } from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { Button } from "@/components/ui/button";

export function Layout({ children }: { children: React.ReactNode }) {
  const { theme, toggleTheme } = useTheme();

  const links = [
    { href: "/", label: "Live", icon: Activity },
    { href: "/history", label: "History", icon: History },
    { href: "/stats", label: "Stats", icon: BarChart3 },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-3 sm:px-6 flex h-14 sm:h-16 items-center justify-between max-w-5xl mx-auto w-full">
          {/* Logo */}
          <div className="flex items-center gap-1.5 font-mono font-bold tracking-tight text-base sm:text-xl shrink-0">
            <Zap className="h-5 w-5 sm:h-6 sm:w-6 text-yellow-400 fill-yellow-400" />
            <span>LIGHTNING<span className="text-yellow-400">BET</span></span>
          </div>

          {/* Nav + Theme toggle */}
          <div className="flex items-center gap-1 sm:gap-2">
            <nav className="flex items-center gap-0.5 sm:gap-1">
              {links.map(({ href, label, icon: Icon }) => (
                <NavLink
                  key={href}
                  to={href}
                  end={href === "/"}
                  className={({ isActive }) =>
                    `flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-2 rounded-md text-xs sm:text-sm font-medium transition-colors ${
                      isActive
                        ? "text-yellow-400 bg-yellow-400/10"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`
                  }
                >
                  <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </nav>

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </header>

      <main
        className="flex-1 px-3 sm:px-6 py-4 sm:py-6 max-w-5xl mx-auto w-full"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        {children}
      </main>
    </div>
  );
}
