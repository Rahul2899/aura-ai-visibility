# Bake the Caddyfile into the image (like nginx/) so deployment needs no bind
# mount — the config travels in the image, which also avoids Docker Desktop
# file-sharing restrictions locally.
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
