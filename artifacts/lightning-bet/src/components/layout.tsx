import { Link, useLocation } from "wouter";
import { Activity, History, BarChart3, Zap } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const links = [
    { href: "/", label: "Live", icon: Activity },
    { href: "/history", label: "History", icon: History },
    { href: "/stats", label: "Stats", icon: BarChart3 },
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-16 items-center">
          <div className="flex items-center gap-2 font-mono text-xl font-bold tracking-tight">
            <Zap className="h-6 w-6 text-yellow-400 fill-yellow-400" />
            <span>LIGHTNING<span className="text-yellow-400">BET</span></span>
          </div>
          
          <nav className="flex items-center gap-6 ml-10">
            {links.map(({ href, label, icon: Icon }) => (
              <Link 
                key={href} 
                href={href} 
                className={`flex items-center gap-2 text-sm font-medium transition-colors hover:text-primary ${location === href ? "text-primary" : "text-muted-foreground"}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1 container py-8">
        {children}
      </main>
    </div>
  );
}
