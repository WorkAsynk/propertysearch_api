// Franchisee suspension levels by tenant (sec. 14.7), held in memory so the
// auth middleware can check them without a query on every request. The
// franchise service refreshes the map whenever a level changes and on a timer.

let levels = new Map(); // tenant_id -> 'level_1' | 'level_2' | 'level_3'
let refreshedAt = 0;
let refresher = null;

const setLevels = (map) => {
  levels = map;
  refreshedAt = Date.now();
};
const setRefresher = (fn) => {
  refresher = fn;
};
const levelOf = (tenantId) => {
  // Lazy refresh: never blocks the request, the next one sees the new state.
  if (refresher && Date.now() - refreshedAt > 30000) {
    refreshedAt = Date.now();
    Promise.resolve(refresher()).catch(() => {});
  }
  return (tenantId && levels.get(tenantId)) || 'active';
};

module.exports = { setLevels, setRefresher, levelOf };
