import { AppHeader, type Connection } from './components/AppHeader.js';
import { TaskList } from './components/TaskList.js';
import { useHealth, useTasks } from './hooks/useTasks.js';

export default function App() {
  const health = useHealth();
  const tasks = useTasks();

  const connection: Connection = health.isSuccess ? 'live' : health.isError ? 'down' : 'connecting';

  return (
    <div className="min-h-dvh">
      <AppHeader
        chain={health.data?.chain}
        connection={connection}
        taskCount={tasks.data?.length}
      />

      <main className="mx-auto max-w-3xl px-5 py-7">
        <TaskList
          tasks={tasks.data}
          isPending={tasks.isPending}
          error={tasks.error}
          onRetry={() => void tasks.refetch()}
        />
      </main>

      <footer className="mx-auto max-w-3xl px-5 pb-10">
        <p className="text-xs text-subtle">
          Reads come from the contract on every poll. Writes are reported only once they are mined.
        </p>
      </footer>
    </div>
  );
}
