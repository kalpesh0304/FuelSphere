#!/bin/bash
# WP-31 criterion 5 and 7. Counts CODE references, not comments - a mapping
# note naming a field it no longer reads is documentation, and counting it as
# a reader would make criterion 7 unreachable by construction.
#
# The instrument is proved on a known-present field AND a known-absent one
# before it is trusted, because a search that finds nothing and a search that
# is broken look identical. It is also proved to EXCLUDE comments and INCLUDE
# code, which is the distinction the whole count rests on.
# The repo root, from this script's own location. Was an absolute path
# while the harnesses lived outside the repository.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIELDS="pilot_signature ground_crew_signature signature_timestamp signature_location"
SCOPE="srv db app"
HARN=test/harness
# drop //, /* , * and # comment lines; everything else is code
# wp31-harness.js is EXCLUDED, and the exclusion is printed rather than
# silent: a test whose purpose is to assert these fields are absent has to
# name them, so counting it would make criterion 7 unreachable by
# construction. Every other harness IS scanned - one of them reading a
# removed field is exactly what this census is for.
code(){ grep -rn "$1" $SCOPE $HARN/*harness*.js 2>/dev/null | grep -v node_modules \
        | grep -v "^gen/" | grep -v "wp31-harness.js" \
        | grep -vE '^[^:]+:[0-9]+: *(//|/\*|\*|#)'; }
echo "== INSTRUMENT PROOF =="
p=$(code "delivered_quantity" | wc -l)
a=$(code "zzz_no_such_field_anywhere" | wc -l)
printf '   known-present  delivered_quantity      %-4s  must be > 0\n' "$p"
printf '   known-absent   zzz_no_such_field       %-4s  must be = 0\n' "$a"
# and prove the comment filter itself, both directions, on a planted pair
t=$(mktemp -d); printf 'x:1: // wp31_probe_token in a comment\nx:2: const wp31_probe_token = 1;\n' > $t/p
c=$(grep -vE '^[^:]+:[0-9]+: *(//|/\*|\*|#)' $t/p | grep -c wp31_probe_token)
n=$(grep -c wp31_probe_token $t/p); rm -rf $t
printf '   comment filter  %s of %s planted lines survive  must be 1 of 2\n' "$c" "$n"
[ "$p" -gt 0 ] && [ "$a" -eq 0 ] && [ "$c" -eq 1 ] && [ "$n" -eq 2 ] \
  || { echo "   INSTRUMENT UNPROVEN - refusing to report"; exit 255; }
echo "   instrument proved, all three ways"
echo
echo "== CENSUS: CODE REFERENCES TO THE FOUR FIELDS =="
echo "   scope: $SCOPE + every harness EXCEPT wp31-harness.js"
echo "   (excluded because asserting a field is absent requires naming it;"
echo "    it names them $(grep -c 'signature' $HARN/wp31-harness.js) times and reads none)"
total=0
for f in $FIELDS; do
  n=$(code "$f" | wc -l); total=$((total+n))
  printf "   %-24s %s\n" "$f" "$n"
  code "$f" | sed 's/^/      /' | cut -c1-125
done
echo
echo "TOTAL CODE REFERENCES: $total"
exit $total
