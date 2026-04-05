import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { Home } from "@/pages/home";
import { History } from "@/pages/history";
import { Stats } from "@/pages/stats";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter basename={base}>
          <Layout>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/history" element={<History />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Layout>
        </BrowserRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
