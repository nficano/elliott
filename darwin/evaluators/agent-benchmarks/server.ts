import { loadDarwinServerConfig, startDarwinServer } from "../../runtime/http";
import { runBenchmark } from "./benchmark";
import { checkCandidate } from "./candidate/check";
import { baseline, compare } from "./evaluation";

const config = loadDarwinServerConfig();

startDarwinServer(config, {
  "/v1/run": runBenchmark,
  "/v1/baseline": baseline,
  "/v1/compare": compare,
  "/v1/candidate/check": checkCandidate,
});

console.error(JSON.stringify({
  event: "darwin.started",
  service: "evaluator-agent-benchmarks",
  host: config.host,
  port: config.port,
  maximumJobs: config.maximumJobs,
  authenticated: config.token.length > 0,
}));
