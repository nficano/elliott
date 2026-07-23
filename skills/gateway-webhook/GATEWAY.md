# Webhook gateway

Accept inbound webhooks only on declared routes. Verify the route signature or
HMAC before broker ingress, drop unverifiable payloads, and stamp accepted
payloads at the route's configured classification.
