import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const TOKEN_FILE = "connector-token";
const OWNER_READ_WRITE = 0o600;

export const connectorTokenPath = (stateDirectory: string): string =>
  path.join(stateDirectory, "cloudflared", TOKEN_FILE);

// The one place a credential this runtime holds is written to disk, and it is
// deliberate: the connector runs in a separate locked-down container, and a
// sibling container cannot read another's memory. A shared volume with an
// owner-only file is the narrowest handoff available without granting elliott a
// Docker socket (root-equivalent) or making it a secret server.
//
// Written to a temp sibling and renamed, so the sidecar never observes a
// partial token — and chmod'd BEFORE the rename, so the file is never briefly
// world-readable at its final path.
export const writeConnectorToken = async (
  stateDirectory: string,
  token: string,
): Promise<void> => {
  const target = connectorTokenPath(stateDirectory);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, token, { mode: OWNER_READ_WRITE });
  await chmod(temporary, OWNER_READ_WRITE);
  await rename(temporary, target);
};
