// Capability vocabulary — <resource>.<action> (TDD §15b): fs.read, fs.write,
// network.connect (parameterized by egress class §14a), secret.use,
// model.use.deep, proposal.create, process.execute.

export { explainGrant, resolveGrantSet } from "../grants/resolution";
export type { Capability, GrantSet, ResourceLimits } from "../grants/types";
