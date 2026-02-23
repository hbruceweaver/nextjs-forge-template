#!/usr/bin/env bash
# PreToolUse hook: Block bare `convex` CLI commands.
# All Convex CLI operations must go through better-convex via pnpm scripts.
#
# Allowed:
#   pnpm --filter @repo/convex dev      (runs better-convex dev)
#   pnpm --filter @repo/convex codegen  (runs better-convex codegen)
#   pnpm --filter @repo/convex typecheck
#
# Blocked:
#   npx convex dev / codegen / deploy / ...
#   convex dev / codegen / deploy / ...
#   npx convex-dev ...
#   better-convex dev  (must go through pnpm scripts)

set -euo pipefail

# Read the tool input from stdin
INPUT=$(cat)

# Extract the command from the Bash tool input
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -z "$COMMAND" ] && exit 0

# Allow safe read-only convex commands (dashboard, logs, env, etc.)
if echo "$COMMAND" | grep -qE 'npx\s+convex\s+(dashboard|logs|env|data|import|export)\b'; then
  exit 0
fi

# Block bare convex CLI usage that affects codegen/dev/deploy
# npx convex dev/codegen/deploy, bare convex ..., bare better-convex ...
if echo "$COMMAND" | grep -qE '(^|[;&|]\s*)(npx\s+convex|npx\s+better-convex|^convex\s|^better-convex\s)'; then
  cat <<'EOF'
{"decision": "block", "reason": "BLOCKED: Never run bare `convex` or `npx convex` commands. They skip shared/meta.ts generation, breaking cRPC proxy types.\n\nUse pnpm scripts instead:\n  pnpm --filter @repo/convex dev        # better-convex dev\n  pnpm --filter @repo/convex codegen     # one-shot codegen\n  pnpm --filter @repo/convex typecheck   # codegen + tsc"}
EOF
  exit 0
fi

exit 0
