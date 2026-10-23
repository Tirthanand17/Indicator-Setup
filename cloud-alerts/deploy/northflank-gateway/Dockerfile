# Northflank Sandbox token-only ingress service. Public HTTPS is terminated by Northflank.
# This does not launch a worker, authenticate to Kite, or enable alerts.
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 8081
