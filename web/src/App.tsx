import { Shell } from "./components/Shell";
import { useAppState } from "./state/store";
import { Overview } from "./screens/Overview";
import { Assistant } from "./screens/Assistant";
import { PlanReview } from "./screens/PlanReview";
import { Tasks } from "./screens/Tasks";
import { Schedule } from "./screens/Schedule";
import { Groceries } from "./screens/Groceries";
import { Household } from "./screens/Household";

export function App() {
  const { view, loading } = useAppState();

  return (
    <Shell>
      {view === "overview" ? <Overview /> : null}
      {view === "assistant" ? <Assistant /> : null}
      {view === "review" ? <PlanReview /> : null}
      {view === "tasks" ? <Tasks /> : null}
      {view === "schedule" ? <Schedule /> : null}
      {view === "groceries" ? <Groceries /> : null}
      {view === "household" ? <Household /> : null}
      {loading && view === "overview" ? (
        <span className="sr-only" role="status">
          Loading household data from the MCP server
        </span>
      ) : null}
    </Shell>
  );
}
