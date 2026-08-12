// Capability vocabulary — <resource>.<action> (TDD §7.17b): fs.read, fs.write,
// network.connect (parameterized by egress class §7.16a), secret.use,
// model.use.deep, proposal.create, process.execute.

export { explainGrant, resolveGrantSet } from "../grants/resolution";
export type { Capability, GrantSet, ResourceLimits } from "../grants/types";
