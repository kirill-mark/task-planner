import { overdue } from "./derive.js";

// Use the full account list, not the searched or paginated screen.
// Every deletion uses the existing persistent queue and recoverable trash.
export async function clearOverdue(store, today, nowMin) {
  const userId = store.userId;
  const ids = overdue(store.rows, today, nowMin).map((t) => t.id);
  let moved = 0;
  try {
    for (const id of ids) {
      if (store.userId !== userId) throw new Error("account changed");
      await store.deleteTask(id);
      moved++;
    }
    return { moved, failed: false };
  } catch {
    return { moved, failed: true };
  }
}
