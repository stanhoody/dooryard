#!/bin/sh
# The mod's checks, for the repo's `verify`: the manifest and module as the
# engine reads them (validate --strict), the tests in the engine's own runtime
# (`claude plugin test`, Claude Code 2.1.299 or later), and a type check where
# the engine has laid this build's types beside the mod.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
claude=${CLAUDE_BIN:-claude}

version=$("$claude" --version | cut -d' ' -f1)
lowest=$(printf '%s\n2.1.299\n' "$version" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)
if [ "$lowest" != "2.1.299" ]; then
  echo "verify: Claude Code $version has no 'plugin test'; set CLAUDE_BIN to 2.1.299 or later" >&2
  exit 1
fi

"$claude" plugin validate --strict "$here"
"$claude" plugin test "$here"

if [ -f "$here/.claude-plugin/types/claude-code/index.d.ts" ] && command -v tsc >/dev/null 2>&1; then
  tsc -p "$here"
else
  echo "verify: type check skipped (no engine-laid types or no tsc)"
fi
