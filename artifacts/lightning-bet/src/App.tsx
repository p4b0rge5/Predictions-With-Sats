import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { Home } from "@/pages/home";
import { History } from "@/pages/history";
import { Stats } from "@/pages/stats";
import { Guide } from "@/pages/guide";
import NotFound from "@/pages/not-found";
import { ThemeProvider } from "@/contexts/theme-context";

const queryClient = new QueryClient();

function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <BrowserRouter basename={base}>
            <Layout>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/history" element={<History />} />
                <Route path="/stats" element={<Stats />} />
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
