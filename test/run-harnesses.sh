#!/usr/bin/env bash
#
# ONE PROCESS PER HARNESS. This is not a preference.
#
# Every harness calls cds.test(), which boots a server and binds a port. Run
# as a single mocha invocation they collide, and the suite reports ~88
# failures that are interference rather than regressions - each harness passes
# clean when run alone. Anyone running these as one batch will conclude the
# build is broken.
#
# Usage:
#   test/run-harnesses.sh              run all
#   test/run-harnesses.sh wp18 d44     run only harnesses whose name matches
#
# Exit code is the number of harnesses that failed, so CI can key on it.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="$ROOT/test/.logs"
mkdir -p "$LOGS"

shopt -s nullglob
files=()
if [ "$#" -eq 0 ]; then
    files=("$ROOT"/test/harness/*harness*.js)
else
    for pat in "$@"; do files+=("$ROOT"/test/harness/*"$pat"*harness*.js); done
fi

# 127, not 1: a filter that matched nothing must be distinguishable from
# one harness failing.
if [ "${#files[@]}" -eq 0 ]; then
    echo "No harness matched: $*" >&2
    exit 127
fi

pass_total=0; fail_total=0; failed_files=0
printf '%-26s %-6s %-12s %s\n' HARNESS EXIT PASSING FAILING
printf '%s\n' "--------------------------------------------------------------"

for f in "${files[@]}"; do
    n="$(basename "$f" .js)"
    ( cd "$ROOT" && npx mocha "$f" --timeout 60000 --reporter dot ) > "$LOGS/$n.log" 2>&1
    code=$?
    pass="$(grep -oE '[0-9]+ passing' "$LOGS/$n.log" | head -1 | grep -oE '^[0-9]+')"
    fail="$(grep -oE '[0-9]+ failing' "$LOGS/$n.log" | head -1 | grep -oE '^[0-9]+')"
    pass_total=$(( pass_total + ${pass:-0} ))
    fail_total=$(( fail_total + ${fail:-0} ))
    [ "$code" -ne 0 ] && failed_files=$(( failed_files + 1 ))
    printf '%-26s %-6s %-12s %s\n' "$n" "$code" "${pass:-0}" "${fail:-0}"
done

printf '%s\n' "--------------------------------------------------------------"
printf '%d passing, %d failing, across %d harness(es); %d harness(es) exited non-zero\n' \
    "$pass_total" "$fail_total" "${#files[@]}" "$failed_files"
echo "Logs: test/.logs/"
exit "$failed_files"
