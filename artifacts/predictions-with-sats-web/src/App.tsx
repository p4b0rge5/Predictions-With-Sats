import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { Home } from "@/pages/home";
import { Landing } from "@/pages/landing";
import { History } from "@/pages/history";
import { Stats } from "@/pages/stats";
import { Guide } from "@/pages/guide";
import { Sports } from "@/pages/sports";
import { Weather } from "@/pages/weather";
import { GlobalMyBets } from "@/pages/my-bets";
import NotFound from "@/pages/not-found";
import { ThemeProvider } from "@/contexts/theme-context";
import { setBaseUrl } from "@workspace/api-client-react";

const queryClient = new QueryClient();

// Configure the API client to route through the same origin prefix.
// The Caddy proxy passes /pwsats/api/* → localhost:3001/api/*
// so the frontend at /pwsats/ can reach the API at /pwsats/api/...
const apiBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
if (apiBase) setBaseUrl(apiBase);

function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <BrowserRouter basename={base}>
            <Layout>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/app" element={<Home />} />
                <Route path="/history" element={<History />} />
                <Route path="/stats" element={<Stats />} />
                <Route path="/sports" element={<Sports />} />
                <Route path="/sports-poly" element={<Navigate to="/sports" replace />} />
                <Route path="/weather" element={<Weather />} />
                <Route path="/my-bets" element={<GlobalMyBets />} />
                <Route path="/guide" element={<Guide />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Layout>
          </BrowserRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
