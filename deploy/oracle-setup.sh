#!/bin/bash
# =====================================================================================
#  Fileverse — automatic setup for an Oracle Cloud "Always Free" Ubuntu 24.04 server.
#
#  Paste this whole file into the "Initialization script" box when you create the
#  instance (Advanced options → Management → Paste cloud-init script).
#  Change ONLY the three values below. Everything else happens automatically
#  (about 25–35 minutes after the server starts).
# =====================================================================================

DUCKDNS_SUBDOMAIN="your-subdomain"          # e.g. fileverse-kshitij   (without .duckdns.org)
DUCKDNS_TOKEN="your-duckdns-token"          # copy it from the top of duckdns.org after signing in
GITHUB_REPO="https://github.com/your-username/fileverse.git"

# ------------------------------- nothing to change below -------------------------------
set -uo pipefail
LOG=/var/log/fileverse-setup.log
exec > >(tee -a "$LOG") 2>&1
echo "== Fileverse setup started: $(date)"

# 1. Allow web traffic through the server's own firewall (Oracle images only allow SSH).
iptables -I INPUT 1 -p tcp -m state --state NEW -m multiport --dports 80,443 -j ACCEPT
netfilter-persistent save 2>/dev/null || true

# 2. Point yoursubdomain.duckdns.org at this server, and keep it pointed (every 5 minutes).
DUCK_URL="https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip="
for i in 1 2 3 4 5; do
  RESULT=$(curl -fsS "$DUCK_URL" || true)
  [ "$RESULT" = "OK" ] && break
  sleep 10
done
echo "DuckDNS update: ${RESULT:-no answer}  (OK = success, KO = wrong subdomain or token)"
echo "*/5 * * * * root curl -fsS '${DUCK_URL}' >/dev/null 2>&1" > /etc/cron.d/duckdns

# 3. Install Docker and git.
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get install -y git curl
curl -fsSL https://get.docker.com | sh
usermod -aG docker ubuntu 2>/dev/null || true
systemctl enable --now docker

# 4. Download Fileverse and start it (the first build installs every engine: ~20–30 min).
rm -rf /opt/fileverse
git clone --depth 1 "$GITHUB_REPO" /opt/fileverse
cd /opt/fileverse
cat > .env <<ENV
DOMAIN=${DUCKDNS_SUBDOMAIN}.duckdns.org
HEAVY_CONCURRENCY=1
LIGHT_CONCURRENCY=2
DISK_RESERVE_MB=8192
FILE_TTL_MINUTES=120
ENV
docker compose up -d --build

# 5. Helper for later updates:  sudo fileverse-update
cat > /usr/local/bin/fileverse-update <<'UPD'
#!/bin/bash
cd /opt/fileverse && git pull && docker compose up -d --build && docker image prune -f
UPD
chmod +x /usr/local/bin/fileverse-update

echo "== Fileverse setup finished: $(date)"
echo "== Open https://${DUCKDNS_SUBDOMAIN}.duckdns.org"
