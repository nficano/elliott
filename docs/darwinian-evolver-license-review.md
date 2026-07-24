# Darwinian Evolver distribution review

**Scope:** Elliott's `evaluator-darwinian` Component and companion image<br>
**Dependency license:** AGPL-3.0, as identified by the adopted upstream plan<br>
**Decision:** Keep Darwinian Evolver outside the Elliott process and package<br>
**Pinned revision:** `7f12365d2059c47e29068a5a6f498a293148d2a9`<br>
**Local distribution status:** OCI image built and smoke-tested; not published

Elliott calls Darwinian Evolver as an external CLI in a dedicated companion
container. Elliott does not import, link, vendor, or copy Darwinian source into
the TypeScript package. The component sends a disposable checkout and a
schema-backed task to the companion. It receives an untrusted patch and engine
metadata.

The companion gets no Git remote, repository credential, host mount, network
egress, or container-runtime socket. The manifest pins the image by digest.
Elliott validates the returned patch before candidate storage or evaluation.

The local build copies the complete pinned source tree, license, dependency
lock, and build metadata into
`/usr/share/darwinian-evolver/source`. Elliott's TypeScript package does not
import or link that code. The image is recorded separately in
`companions/evolution-images.lock.json`.

Anyone who publishes the companion image containing Darwinian Evolver must:

1. Confirm the exact upstream revision and its license with counsel.
2. Include the required license text, notices, and corresponding source offer
   or source delivery mechanism in the image distribution.
3. Record the upstream revision, build recipe, dependency lock, and image
   digest in release evidence.
4. Keep the image in a separate distribution from the Elliott TypeScript
   package unless counsel approves a combined distribution.
5. Re-run this review after an upstream license change or a change from CLI
   invocation to import or linking.

This repository now defines and locally builds the external distribution. It
does not publish that image to a registry. Registry publication still requires
the source-delivery and notice obligations above, an authorized registry, and
the organization's legal approval.
