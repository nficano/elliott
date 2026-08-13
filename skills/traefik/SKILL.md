---
name: traefik
description: Publish LAN services through Traefik with automatic HTTPS certs.
---

# Traefik

Manage the reverse-proxy routes Traefik serves for local domains. Managed
routes are persisted in runtime state and published as a Traefik dynamic
configuration document at `GET /v1/traefik/dynamic`; point Traefik's HTTP
provider (`--providers.http.endpoint`) at that URL. Every route is created
with `tls.certResolver`, so Traefik issues and renews the HTTPS certificate
for the hostname automatically (DNS-01 works for LAN-only domains). Adding or
removing a route changes what the proxy exposes — explain the change first.
The read-only Traefik API is used to report live router status.
