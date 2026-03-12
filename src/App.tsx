import { ProjectBar } from "./components/ProjectBar";
import { StatusBar } from "./components/StatusBar";
import { PaneContainer } from "./components/PaneContainer";
import { DragOverlay } from "./components/DragOverlay";
import { useLayoutStore } from "./store";
import "./globals.css";

function App() {
  const layout = useLayoutStore((s) => s.layout);

  return (
    <div className="font-ui flex flex-col h-screen w-screen overflow-hidden">
      <ProjectBar />
      <div className="flex-1 min-h-0 flex">
        <PaneContainer node={layout} />
      </div>
      <StatusBar />
      <DragOverlay />
    </div>
  );
}

export default App;
