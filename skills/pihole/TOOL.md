---
name: pihole
description: Manage local DNS records on the LAN Pi-hole via its REST API.
---

# Pi-hole

Read and edit the local DNS table (A records and CNAME aliases) on the
household Pi-hole. The skill detects the API generation on first use: the
v6 FTL REST API (`/api/config/dns/*`, session auth) or the v5 AdminLTE API
(`/admin/api.php?customdns`, token auth derived from the same password), so
it survives a v5 → v6 upgrade unchanged. Setting or removing a record
changes name resolution for every device on the network, so explain the
change before making it.
