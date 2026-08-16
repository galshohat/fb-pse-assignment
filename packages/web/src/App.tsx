import { ActivityLog } from './components/ActivityLog.js';
import { AddTaskForm } from './components/AddTaskForm.js';
import { AppHeader, type Connection } from './components/AppHeader.js';
import { TaskList } from './components/TaskList.js';
import { useHealth, useTasks } from './hooks/useTasks.js';
import { useAddTask, useCompleteTask } from './hooks/useWrites.js';

export default function App() {
  const health = useHealth();
  const tasks = useTasks();
  const add = useAddTask();
  const { complete, inFlight } = useCompleteTask();

  const connection: Connection = health.isSuccess ? 'live' : health.isError ? 'down' : 'connecting';

  return (
    <div className="min-h-dvh">
      <AppHeader
        chain={health.data?.chain}
        connection={connection}
        taskCount={tasks.data?.length}
      />

      <main className="mx-auto max-w-4xl px-6 py-8">
        <AddTaskForm onSubmit={add.mutate} isPending={add.isPending} startedAt={add.submittedAt} />

        <TaskList
          tasks={tasks.data}
          isPending={tasks.isPending}
          error={tasks.error}
          onRetry={() => void tasks.refetch()}
          // `variables` is the description of the write currently in flight,
          // which is exactly what the pending row needs to show.
          pendingAdd={
            add.isPending && add.variables !== undefined
              ? { description: add.variables, startedAt: add.submittedAt }
              : undefined
          }
          completing={inFlight}
          onComplete={complete}
        />

        <ActivityLog />
      </main>

      <footer className="mx-auto max-w-4xl px-6 pt-2 pb-12">
        <p className="text-xs leading-relaxed text-subtle">
          Reads come from the contract on every poll. Writes are reported only once they are mined.
        </p>
      </footer>
    </div>
  );
}
