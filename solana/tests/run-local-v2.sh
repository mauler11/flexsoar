#!/usr/bin/env bash
# Pinned Agave 2.1 binds RPC/pubsub/faucet to wildcard even with --bind-address.
# Confine the ENTIRE harness/validator to a fresh rootless, loopback-only netns.
set -euo pipefail
if [[ $# -ne 1 || ! -f "$1" || "$1" != *.so ]]; then
  echo 'Usage: bash run-local-v2.sh <reviewed-built.so>' >&2
  exit 2
fi
task_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
parent_network="$(readlink /proc/self/ns/net)"
tools_dir=/home/family/.local/opt/flexsoar-tools
mkdir -p /home/family/.cache/flexsoar-rust-tmp
exec unshare --user --map-root-user --net -- bash -c 'set -e; ip link set lo up; exec "$@"' flexsoar-private-network   env FLEXSOAR_PARENT_NETNS="$parent_network"   PATH="/home/family/.cargo/bin:$tools_dir/anchor-0.31.1:$tools_dir/agave-2.1.0/solana-release/bin:$tools_dir/node-22.14.0/bin:/usr/local/bin:/usr/bin:/bin"   TMPDIR=/home/family/.cache/flexsoar-rust-tmp   node "$task_dir/local-v2.mjs" --run-local-validator --program-so "$1"
