// Shared between OrderListRow/OrderDetailPanel/PosScreen/OrderHistoryView so
// the sync-status label/badge look identical everywhere an order appears.
export function orderSyncLabel(status) {
  return { synced: 'Synced', pending: 'Pending', failed: 'Failed', conflict: 'Conflict' }[status] || status;
}

export function orderSyncBadgeClass(status) {
  return {
    'bg-success': status === 'synced',
    'bg-warning text-dark': status === 'pending',
    'bg-danger': status === 'failed' || status === 'conflict',
  };
}

/**
 * order:sync-one / order:sync-all resolve successfully (no thrown error)
 * even when every pushed transaction was individually rejected by the
 * server - e.g. a held order can't sync until its own register session has
 * synced first. Without checking `results[].status`, the UI would show
 * "Order synced" on an order that's still stuck. Turns the raw
 * { pushed, results } into one toast message.
 */
export function describeSyncResult(res, { singular = false } = {}) {
  const results = res?.results || [];
  if (!res?.pushed) {
    return singular ? 'Nothing to sync for this order.' : 'Nothing to sync.';
  }

  const failed = results.filter((r) => r.status !== 'synced');
  if (!failed.length) {
    return singular ? 'Order synced.' : `Synced ${res.pushed} order transaction(s).`;
  }

  if (singular) {
    return failed[failed.length - 1].error || 'Sync failed.';
  }

  const succeeded = res.pushed - failed.length;
  return `${succeeded} synced, ${failed.length} failed: ${failed[failed.length - 1].error || 'unknown error'}`;
}
