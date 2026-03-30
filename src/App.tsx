import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceProvider } from "./WorkspaceContext";
import { WorkspaceGate } from "./WorkspaceGate";
import { isMacOS, isWindows } from "./platform";
import "./index.css";

const platformClass = isMacOS ? "platform-macos" : isWindows ? "platform-windows" : "";

export function App() {
  return (
    <TooltipProvider>
      <WorkspaceProvider>
        <div className={`app ${platformClass}`}>
          <WorkspaceGate />
        </div>
      </WorkspaceProvider>
    </TooltipProvider>
  );
}
