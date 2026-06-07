FROM nginx:alpine
# Bake the config into the image instead of bind-mounting it. Mounts require host
# file-sharing permission (a pain on Docker Desktop) and are a deploy fragility;
# shipping the config in the image is immutable and portable.
COPY nginx.conf /etc/nginx/nginx.conf
