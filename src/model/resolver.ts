// Model resolution: thin per-invocation dispatch — TDD §5d. Steps: profile +
// ceiling, effective classification (max of declared and frame mark), table
// lookup with epoch/digest currency check, budget filter, selection record.
// Empty candidate set raises NoEligibleRouteError; filters never relax.
//
// Deferred to M4: implement dispatch against RouteTable + EpochRegistry.

export {};
