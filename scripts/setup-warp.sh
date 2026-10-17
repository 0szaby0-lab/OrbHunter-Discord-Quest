#!/bin/bash
# ─────────────────────────────────────────────────────
# Cloudflare WARP setup via wgcf + wireproxy (userspace)
# 100% free, no NET_ADMIN, no root required
# Creates a local SOCKS5 proxy at 127.0.0.1:1080
# ─────────────────────────────────────────────────────

set -e

WARP_DIR="${WARP_DIR:-/tmp/warp}"
WIREPROXY_PORT="${WIREPROXY_PORT:-1080}"

mkdir -p "$WARP_DIR"
cd "$WARP_DIR"

# ── Download wgcf if missing ──
if [ ! -f "$WARP_DIR/wgcf" ]; then
  echo "[WARP] ⬇️  Downloading wgcf..."
  curl -fsSL -o "$WARP_DIR/wgcf" "https://github.com/ViRb3/wgcf/releases/latest/download/wgcf_linux_amd64"
  chmod +x "$WARP_DIR/wgcf"
fi

# ── Download wireproxy if missing ──
if [ ! -f "$WARP_DIR/wireproxy" ]; then
  echo "[WARP] ⬇️  Downloading wireproxy..."
  # Get latest release tag
  LATEST_TAG=$(curl -fsSL "https://api.github.com/repos/octeep/wireproxy/releases/latest" | grep -o '"tag_name":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -z "$LATEST_TAG" ]; then
    LATEST_TAG="v1.0.9"
  fi
  echo "[WARP] Using wireproxy $LATEST_TAG"
  curl -fsSL -o "$WARP_DIR/wireproxy.tar.gz" "https://github.com/octeep/wireproxy/releases/download/${LATEST_TAG}/wireproxy_linux_amd64.tar.gz"
  tar -xzf "$WARP_DIR/wireproxy.tar.gz" -C "$WARP_DIR"
  chmod +x "$WARP_DIR/wireproxy"
  rm -f "$WARP_DIR/wireproxy.tar.gz"
fi

# ── Register with Cloudflare WARP (once) ──
if [ ! -f "$WARP_DIR/wgcf-account.toml" ]; then
  echo "[WARP] 🔑 Registering new Cloudflare WARP account..."
  "$WARP_DIR/wgcf" register --accept-tos
fi

# ── Generate WireGuard profile ──
if [ ! -f "$WARP_DIR/wgcf-profile.conf" ]; then
  echo "[WARP] 📄 Generating WireGuard profile..."
  "$WARP_DIR/wgcf" generate
fi

# ── Parse profile and create wireproxy config ──
PRIVATE_KEY=$(grep "PrivateKey" "$WARP_DIR/wgcf-profile.conf" | head -1 | awk '{print $3}')
PUBLIC_KEY=$(grep "PublicKey" "$WARP_DIR/wgcf-profile.conf" | head -1 | awk '{print $3}')
ADDRESS_V4=$(grep "Address" "$WARP_DIR/wgcf-profile.conf" | head -1 | awk '{print $3}')
ADDRESS_V6=$(grep "Address" "$WARP_DIR/wgcf-profile.conf" | tail -1 | awk '{print $3}')
ENDPOINT=$(grep "Endpoint" "$WARP_DIR/wgcf-profile.conf" | head -1 | awk '{print $3}')

cat > "$WARP_DIR/wireproxy.conf" << EOF
[Interface]
PrivateKey = ${PRIVATE_KEY}
Address = ${ADDRESS_V4}
DNS = 1.1.1.1, 1.0.0.1
MTU = 1280

[Peer]
PublicKey = ${PUBLIC_KEY}
Endpoint = ${ENDPOINT:-engage.cloudflareclient.com:2408}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25

[Socks5]
BindAddress = 127.0.0.1:${WIREPROXY_PORT}
EOF

echo "[WARP] ✅ wireproxy config ready at $WARP_DIR/wireproxy.conf"
echo "[WARP] 🚀 Starting wireproxy SOCKS5 on 127.0.0.1:${WIREPROXY_PORT}..."

# Run wireproxy in background
"$WARP_DIR/wireproxy" -c "$WARP_DIR/wireproxy.conf" &
WIREPROXY_PID=$!
echo "[WARP] 🔄 wireproxy PID: $WIREPROXY_PID"

# Wait a moment for proxy to come up
sleep 2

# Verify it's running
if kill -0 $WIREPROXY_PID 2>/dev/null; then
  echo "[WARP] ✅ wireproxy is running! SOCKS5 proxy active on 127.0.0.1:${WIREPROXY_PORT}"
else
  echo "[WARP] ⚠️  wireproxy failed to start. Continuing without WARP proxy."
fi
