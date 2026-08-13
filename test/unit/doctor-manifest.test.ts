import { describe, expect, it } from "bun:test";
import { readManifestSecretRefs } from "../../src/runtime/doctor/manifest";

describe("readManifestSecretRefs", () => {
  it("reads the secret.use references a manifest declares", async () => {
    const refs = await readManifestSecretRefs("skills/search-brave");
    expect(refs).toContain("secret://search/brave/api-key");
  });

  it("returns none for a skill that declares no secret capability", async () => {
    const refs = await readManifestSecretRefs("skills/fetch");
    expect(refs).toEqual([]);
  });

  it("returns none when the directory has no readable manifest", async () => {
    const refs = await readManifestSecretRefs("skills/does-not-exist");
    expect(refs).toEqual([]);
  });
});
