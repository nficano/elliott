import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { isJsonRecord } from "../../providers/http";

const SECRET_CAPABILITY = "secret.use";

// The secret:// references a manifest declares under spec.capabilities. These
// are the authoritative "what secret to supply" pointers for a dormant skill;
// the doctor shows them beside the gate so an operator knows exactly what to
// set. A manifest that cannot be read contributes no references rather than
// failing the whole run — the gate string alone still names the missing key.
export const readManifestSecretRefs = async (
  directory: string,
): Promise<readonly string[]> => {
  let raw: string;
  try {
    raw = await readFile(path.join(directory, "manifest.yaml"), "utf8");
  } catch {
    return [];
  }
  const value: unknown = parse(raw);
  if (!isJsonRecord(value)) return [];
  const spec = value["spec"];
  if (!isJsonRecord(spec)) return [];
  const capabilities = spec["capabilities"];
  if (!Array.isArray(capabilities)) return [];
  return capabilities.flatMap((entry): readonly string[] => {
    if (!isJsonRecord(entry) || entry["capability"] !== SECRET_CAPABILITY) {
      return [];
    }
    const resources = entry["resources"];
    if (!Array.isArray(resources)) return [];
    return resources.filter((item): item is string => typeof item === "string");
  });
};
