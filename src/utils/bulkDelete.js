// Runs `deleteOne(id)` for every id in the list, collecting successes and
// per-id failures instead of letting one bad id (not found, not owned,
// wrong tenant) abort the whole batch. `deleteOne` is expected to run the
// exact same existence + ownership checks the single DELETE endpoint would
// (and throw the same errors), so bulk delete never bypasses authorization
// a single delete would have enforced - it's just that same logic run in a
// loop, not a separate/looser code path.
async function bulkDelete(ids, deleteOne) {
  const deletedIds = [];
  const failed = [];

  for (const id of ids) {
    try {
      await deleteOne(id);
      deletedIds.push(id);
    } catch (err) {
      failed.push({ id, reason: err.message });
    }
  }

  return { deletedCount: deletedIds.length, deletedIds, failed };
}

module.exports = { bulkDelete };
