#!/usr/bin/env bash
# Host WSL only. Creates a NEW helper, never a DB container, port, network or SQL bootstrap.
set -euo pipefail
[[ "${1:-}" == --create-isolated-helper && $# == 1 ]] || { echo 'Explicit --create-isolated-helper required' >&2; exit 2; }
N=flexsoar-payment-db-69c6161-20261016T022841Z
R=/home/family/$N
D=$R/integration-helper-$(date -u +%Y%m%dT%H%M%SZ)
H=flexsoar-payment-integration-$(date -u +%Y%m%dT%H%M%SZ)
mkdir "$D"
docker inspect "$N" > "$D/database-inspect.json"
python3 - "$D/database-inspect.json" <<'PYGUARD'
import json,sys
x=json.load(open(sys.argv[1]))[0]
assert x['Id']=='71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92'
assert x['State']['Running'] and x['HostConfig']['NetworkMode']=='none' and not x['HostConfig']['PortBindings']
assert x['Config']['Image']=='supabase/postgres@sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc'
assert len(x['Mounts'])==3 and all(not m['RW'] for m in x['Mounts'])
PYGUARD
if docker container inspect "$H" >/dev/null 2>&1;then echo 'Helper name exists; refusing' >&2;exit 2;fi
mkdir "$D/helper-state"
docker run -d --name "$H" --network "container:$N" --user 1000:1000 --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=512m,mode=1777 \
 --mount type=bind,source=/home/family/.local/opt/flexsoar-tools/node-22.14.0/bin/node,target=/tools/node,readonly \
 --mount type=bind,source=/home/family/.local/opt/flexsoar-tools/agave-2.1.0/solana-release/bin,target=/tools/agave,readonly \
 --mount type=bind,source=/usr/lib/x86_64-linux-gnu,target=/tools/runtime,readonly \
 --mount type=bind,source=/home/family/.cache/flexsoar-v2-local-build/flexsoar_settlement.so,target=/tools/program.so,readonly \
 --mount type=bind,source=/mnt/c/Users/Family/flexsoar-payment-security/node_modules,target=/work/node_modules,readonly \
 --mount type=bind,source=/mnt/c/Users/Family/flexsoar-payment-security/lib,target=/work/lib,readonly \
 --mount type=bind,source=/mnt/c/Users/Family/flexsoar-payment-security/tests/payment-integration,target=/work/tests/payment-integration,readonly \
 --mount type=bind,source="$D/helper-state",target=/state \
 --entrypoint /bin/sh supabase/postgres@sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc -c 'exec sleep infinity' > "$D/helper-id.txt"
echo "$H" > "$D/helper-name"
docker inspect "$H" > "$D/helper-inspect.json"
docker exec "$H" /tools/runtime/ld-linux-x86-64.so.2 --library-path /tools/runtime /tools/node --version
docker exec "$H" /tools/runtime/ld-linux-x86-64.so.2 --library-path /tools/runtime /tools/agave/solana-test-validator --version
docker exec "$H" sh -c 'cat /proc/net/dev; cat /proc/net/route; command -v psql'

DBNS=$(docker exec "$N" readlink /proc/self/ns/net)
HNS=$(docker exec "$H" readlink /proc/self/ns/net)
[[ "$DBNS" == "$HNS" ]] || { echo 'Namespace mismatch' >&2; exit 2; }
printf 'Created helper %s; evidence %s; namespace %s\n' "$H" "$D" "$HNS"
# No DB connections or validator startup occur automatically. See README.
