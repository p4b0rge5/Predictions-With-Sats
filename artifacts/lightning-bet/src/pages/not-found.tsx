import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center gap-6 font-mono text-center">
      <div className="text-8xl font-bold text-muted-foreground/30 tracking-tighter">404</div>
      <div>
        <h1 className="text-2xl font-bold uppercase tracking-widest mb-2">Page Not Found</h1>
        <p className="text-muted-foreground text-sm">This window doesn't exist.</p>
      </div>
      <Button asChild variant="outline" className="font-mono uppercase tracking-wider">
        <Link to="/">Back to Live</Link>
      </Button>
    </div>
  );
}
