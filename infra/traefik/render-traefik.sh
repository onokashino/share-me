#!/bin/sh
# Renders Traefik's config from env, then starts Traefik. Two deploy modes:
#
#   DOMAIN empty  ->  plain HTTP on :80, path-routed. Reach the server by its IP
#                     (or http://localhost locally). No certificate.
#   DOMAIN set    ->  HTTPS on :443 with an automatic Let's Encrypt certificate
#                     for $DOMAIN; :80 permanently redirects to :443. Set
#                     ACME_EMAIL too.
#
# For HTTPS: point the domain's A/AAAA record at this server first. The cert is
# obtained on the first request (TLS-ALPN-01 — needs :443 reachable from the
# internet) and persisted in the `letsencrypt` volume, so it survives restarts.
set -e

mkdir -p /etc/traefik/dynamic /letsencrypt

if [ -n "${DOMAIN}" ]; then
  echo "traefik: HTTPS mode -> https://${DOMAIN} (Let's Encrypt, email='${ACME_EMAIL}')"

  cat > /etc/traefik/traefik.yml <<EOF
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
  websecure:
    address: ":443"
providers:
  file:
    directory: /etc/traefik/dynamic
    watch: true
certificatesResolvers:
  le:
    acme:
      email: "${ACME_EMAIL}"
      storage: /letsencrypt/acme.json
      tlsChallenge: {}
log:
  level: INFO
EOF

  cat > /etc/traefik/dynamic/routes.yml <<EOF
http:
  routers:
    api:
      rule: "Host(\`${DOMAIN}\`) && PathPrefix(\`/api\`)"
      entryPoints: [websecure]
      service: api
      priority: 100
      tls:
        certResolver: le
    web:
      rule: "Host(\`${DOMAIN}\`)"
      entryPoints: [websecure]
      service: web
      priority: 1
      tls:
        certResolver: le
  services:
    api:
      loadBalancer:
        servers:
          - url: "http://api:8080"
    web:
      loadBalancer:
        servers:
          - url: "http://web:3000"
EOF

else
  echo "traefik: HTTP mode -> reach the server by IP (set DOMAIN in .env for HTTPS)"

  cat > /etc/traefik/traefik.yml <<EOF
entryPoints:
  web:
    address: ":80"
providers:
  file:
    directory: /etc/traefik/dynamic
    watch: true
log:
  level: INFO
EOF

  cat > /etc/traefik/dynamic/routes.yml <<EOF
http:
  routers:
    api:
      rule: "PathPrefix(\`/api\`)"
      entryPoints: [web]
      service: api
      priority: 100
    web:
      rule: "PathPrefix(\`/\`)"
      entryPoints: [web]
      service: web
      priority: 1
  services:
    api:
      loadBalancer:
        servers:
          - url: "http://api:8080"
    web:
      loadBalancer:
        servers:
          - url: "http://web:3000"
EOF
fi

exec traefik --configFile=/etc/traefik/traefik.yml
