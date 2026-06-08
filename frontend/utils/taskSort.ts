export interface Task {
  id: number;
  status: 'todo' | 'in_progress' | 'completed';
  approval_status?: 'pending' | 'in_progress' | 'waiting_approval' | 'completed' | 'revision_required';
  completed: boolean;
  [key: string]: any;
}

export function sortTasksStable<T extends Task>(tasks: T[]): T[] {
  if (!Array.isArray(tasks)) return [];
  const active: T[] = [];
  const completed: T[] = [];
  
  for (const task of tasks) {
    const isCompleted = task.status === 'completed' || task.approval_status === 'completed' || task.completed === true;
    if (isCompleted) {
      completed.push(task);
    } else {
      active.push(task);
    }
  }
  return [...active, ...completed];
}
