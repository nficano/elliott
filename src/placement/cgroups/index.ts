import type { CgroupCompilationInput, CgroupSettings } from "../types";

const BYTES_PER_MEBIBYTE = 1_048_576;

export const compileCgroupSettings = (
  input: CgroupCompilationInput,
): CgroupSettings => ({
  ...(input.limits.cpuQuota !== undefined && { cpuMax: input.limits.cpuQuota }),
  ...(input.limits.memoryMb !== undefined
    && { memoryMaxBytes: input.limits.memoryMb * BYTES_PER_MEBIBYTE }),
  ...(input.limits.pids !== undefined && { pidsMax: input.limits.pids }),
  ...(input.limits.ioBytesPerSecond !== undefined
    && { ioMaxBytesPerSecond: input.limits.ioBytesPerSecond }),
});
