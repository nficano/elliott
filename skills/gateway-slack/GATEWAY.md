# Slack gateway

Use Socket Mode for inbound messages and the Web API for replies. Acknowledge
each envelope before processing, ignore bot/self messages, and admit only
paired senders. Every inbound message is untrusted at its route classification.
