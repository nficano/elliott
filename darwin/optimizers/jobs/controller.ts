import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  canonicalJson,
  MAX_RESPONSE_BYTES,
  wireError,
} from "../../runtime/wire";
import {
  decodeOptimizerRequest,
  decodeOptimizerResult,
  type OptimizerRequest,
} from "../contract";
import {
  CANCEL_WAIT_MILLISECONDS,
  childEnvironment,
  errorMessage,
  HTTP_INTERNAL_SERVER_ERROR,
  isRecord,
  type Job,
  type JobControllerConfig,
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
  requireRecord,
  SerialGate,
  TEMPORARY_ROOT,
} from "./support";

export type { JobControllerConfig } from "./support";

export class JobController {
  readonly #config: JobControllerConfig;
  readonly #byRunId = new Map<string, Job>();
  readonly #byToken = new Map<string, Job>();
  readonly #startGate = new SerialGate();

  constructor(config: JobControllerConfig) {
    this.#config = config;
  }

  async start(value: unknown): Promise<unknown> {
    const job = await this.#startGate.use(async () => {
      const request = decodeOptimizerRequest(value, this.#config.kind);
      const runId = request.run.id;
      const existing = this.#byRunId.get(runId);
      if (existing !== undefined && existing.child.exitCode === null) {
        return wireError("run already has an active worker");
      }
      if (this.#activeJobs() >= this.#config.maximumJobs) {
        return wireError("darwin concurrency limit reached");
      }
      const started = await this.#spawn(request);
      this.#byRunId.set(runId, started);
      this.#byToken.set(started.token, started);
      return started;
    });
    return job.gate.use(() => this.#awaitOrPause(job));
  }

  async pause(runId: string): Promise<string> {
    const job = this.#byRunId.get(runId);
    if (job === undefined) {
      return wireError("run was not found");
    }
    return job.gate.use(async () => {
      if (job.child.exitCode === null && !job.paused) {
        this.#signalGroup(job, "SIGSTOP");
        job.paused = true;
      }
      return job.token;
    });
  }

  async resume(token: string): Promise<unknown> {
    const job = this.#byToken.get(token);
    if (job === undefined) {
      return wireError("resume token was not found");
    }
    return job.gate.use(async () => {
      if (job.child.exitCode === null && job.paused) {
        this.#signalGroup(job, "SIGCONT");
        job.paused = false;
      }
      return this.#awaitOrPause(job);
    });
  }

  async cancel(runId: string): Promise<void> {
    const job = this.#byRunId.get(runId);
    if (job === undefined) return;
    await job.gate.use(async () => {
      if (job.child.exitCode === null) {
        this.#signalGroup(job, "SIGKILL");
        await Promise.race([
          job.child.exited,
          Bun.sleep(CANCEL_WAIT_MILLISECONDS),
        ]);
      }
      await this.#cleanup(job);
    });
  }

  #activeJobs(): number {
    return [...this.#byRunId.values()].filter(
      (job) => job.child.exitCode === null,
    ).length;
  }

  async #spawn(
    request: OptimizerRequest,
  ): Promise<Job> {
    const root = await mkdtemp(path.join(TEMPORARY_ROOT, "elliott-job-"));
    await chmod(root, PRIVATE_DIRECTORY_MODE);
    const requestPath = path.join(root, "request.json");
    const resultPath = path.join(root, "result.json");
    await writeFile(requestPath, canonicalJson(request), {
      mode: PRIVATE_FILE_MODE,
    });
    const child = Bun.spawn(
      [...this.#config.workerCommand, requestPath, resultPath],
      {
        cwd: root,
        detached: true,
        env: childEnvironment(this.#config.environment ?? Bun.env),
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      },
    );
    return {
      runId: request.run.id,
      request,
      token: crypto.randomUUID(),
      child,
      root,
      resultPath,
      deadline: performance.now() + request.maximumDurationMilliseconds,
      gate: new SerialGate(),
      paused: false,
    };
  }

  async #awaitOrPause(
    job: Job,
  ): Promise<unknown> {
    const remaining = job.deadline - performance.now();
    if (remaining <= 0) {
      if (job.child.exitCode === null) {
        this.#signalGroup(job, "SIGKILL");
        await job.child.exited;
      }
      await this.#cleanup(job);
      return wireError("optimization duration budget exhausted");
    }
    const wait = Math.min(this.#config.sliceMilliseconds, remaining);
    const outcome = await Promise.race([
      job.child.exited.then((): "exited" => "exited"),
      Bun.sleep(wait).then((): "slice" => "slice"),
    ]);
    if (outcome === "slice" && job.child.exitCode === null) {
      this.#signalGroup(job, "SIGSTOP");
      job.paused = true;
      return {
        runId: job.runId,
        candidates: [],
        paused: true,
        resumeToken: job.token,
      };
    }
    return this.#readResult(job);
  }

  async #readResult(job: Job): Promise<unknown> {
    try {
      const resultSize = (await stat(job.resultPath)).size;
      if (resultSize > MAX_RESPONSE_BYTES) {
        return wireError(
          "worker response exceeds the size limit",
          HTTP_INTERNAL_SERVER_ERROR,
        );
      }
      const result = requireRecord(
        JSON.parse(await readFile(job.resultPath, "utf8")),
        "worker result",
      );
      const error = result["error"];
      if (isRecord(error)) {
        return wireError(errorMessage(error), HTTP_INTERNAL_SERVER_ERROR);
      }
      return decodeOptimizerResult(result, job.request);
    } catch (error) {
      if (error instanceof Error && error.name === "DarwinWireError") {
        throw error;
      }
      const detail = error instanceof Error ? error.message : String(error);
      return wireError(
        `worker exited without a valid result: ${detail}`,
        HTTP_INTERNAL_SERVER_ERROR,
      );
    } finally {
      await this.#cleanup(job);
    }
  }

  #signalGroup(job: Job, signal: NodeJS.Signals): void {
    try {
      process.kill(-job.child.pid, signal);
    } catch (error) {
      if (job.child.exitCode === null) throw error;
    }
  }

  async #cleanup(job: Job): Promise<void> {
    if (this.#byRunId.get(job.runId) === job) {
      this.#byRunId.delete(job.runId);
    }
    this.#byToken.delete(job.token);
    await rm(job.root, { recursive: true, force: true });
  }
}
