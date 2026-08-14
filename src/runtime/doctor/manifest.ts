import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { isJsonRecord } from "../../providers/http";

const SECRET_CAPABILITY = "secret.use";

// A well-formed opaque secret reference: the `secret://` scheme followed by a
// path drawn from a conservative character set (no whitespace, control, or
// line-forging characters). The doctor PRINTS these beside a dormant skill's
// gate, and the manifest is agent-local (untrusted), so it forwards only values
// it can prove are references — never an arbitrary string a manifest placed under
// `resources`, which could be a literal credential. This enumerates the good
// shape rather than trying to spot the bad ones.
const SECRET_REFERENCE_URI = /^secret:\/\/[\w./:@%+~=-]+$/;
const isSecretReferenceUri = (value: string): boolean =>
  SECRET_REFERENCE_URI.test(value);

// The secret:// references a manifest declares under spec.capabilities. These
// are the authoritative "what secret to supply" pointers for a dormant skill;
// the doctor shows them beside the gate so an operator knows exactly what to
// set. A manifest that cannot be read contributes no references rather than
// failing the whole run — the gate string alone still names the missing key. A
// resource that is not a well-formed `secret://` reference is dropped, not
// printed: it is not a pointer this repo owns, and forwarding it verbatim would
// let a manifest inject credential text (or a forged line) into the report.
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
    return resources.filter((item): item is string =>
      typeof item === "string" && isSecretReferenceUri(item)
    );
  });
};
