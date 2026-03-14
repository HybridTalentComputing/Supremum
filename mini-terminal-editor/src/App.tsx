import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceProvider } from "./WorkspaceContext";
import { WorkspaceGate } from "./WorkspaceGate";
import "./index.css";

export function App() {
  return (
    <TooltipProvider>
      <WorkspaceProvider>
        <div className="app">
          <WorkspaceGate />
        </div>
      </WorkspaceProvider>
    </TooltipProvider>
  );
}
