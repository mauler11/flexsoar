#!/usr/bin/env bash
# Host-side prerequisite for integrated.mjs. No database mutations or startup.
set -euo pipefail
[[ $# == 1 && "$1" == flexsoar-payment-integration-* ]] || { echo 'Exact existing integration helper name required' >&2;exit 2; }
N=flexsoar-payment-db-69c6161-20261016T022841Z
H=$1
R=/home/family/$N/integration-attestation-$(date -u +%Y%m%dT%H%M%SZ)
mkdir "$R"
docker inspect "$N" > "$R/database.json"
docker inspect "$H" > "$R/helper.json"
python3 - "$R/database.json" "$R/helper.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))[0];h=json.load(open(sys.argv[2]))[0]
assert d['Id']=='71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92'
assert d['State']['Running'] and d['HostConfig']['NetworkMode']=='none' and not d['HostConfig']['PortBindings']
assert d['Config']['Image']=='supabase/postgres@sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc'
assert len(d['Mounts'])==3 and all(not m['RW'] for m in d['Mounts'])
assert h['State']['Running'] and h['HostConfig']['NetworkMode']=='container:'+d['Id']
assert not h['HostConfig']['PortBindings'] and not h['HostConfig']['Privileged']
assert h['HostConfig']['ReadonlyRootfs'] and h['Config']['User']=='1000:1000'
assert 'ALL' in h['HostConfig']['CapDrop'] and 'no-new-privileges' in h['HostConfig']['SecurityOpt']
assert all(m['Destination'] in ['/state','/tools/node','/tools/agave','/tools/runtime','/tools/program.so','/work/node_modules','/work/lib','/work/tests/payment-integration'] for m in h['Mounts'])
assert all(not m['RW'] for m in h['Mounts'] if m['Destination']!='/state')
PY
NS=$(docker exec "$N" readlink /proc/self/ns/net)
[[ "$NS" == "$(docker exec "$H" readlink /proc/self/ns/net)" ]]
S=$(docker inspect "$H" --format '{{range .Mounts}}{{if eq .Destination "/state"}}{{.Source}}{{end}}{{end}}')
python3 - "$S/integration-host-attestation.json" "$NS" <<'PY'
import json,sys
json.dump(dict(containerId='71c4856abae69c7fa2a544052c6fe7bdb54403dec121f6aa39be982ac1f8cc92',network='none',database='flexsoar_payment_v2_integration_test',namespace=sys.argv[2]),open(sys.argv[1],'w'))
PY
echo "Attested $H in $NS. Evidence $R. No database connection or validator started."
