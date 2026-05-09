#!/usr/bin/env bash
# v1.4 — one-shot Supabase production deploy: secrets + Edge Functions.
#
# Pushes secrets from supabase/.env.production (Stripe-optional) and
# deploys Edge Functions to the linked Supabase project. Skips the 3
# Stripe-coupled functions by default; pass --with-stripe once you have
# Stripe configured.
#
# Prerequisites:
#   1. supabase CLI installed (`brew install supabase/tap/supabase`)
#   2. Project linked: `supabase link --project-ref <ref>` already run
#   3. supabase/.env.production exists and is gitignored
#   4. Migrations already pushed: `supabase db push --db-url "$PAPERFLOW_DB_URL"`
#
# Usage:
#   bash scripts/deploy-supabase.sh                    # 5 non-Stripe functions
#   bash scripts/deploy-supabase.sh --with-stripe      # all 8 functions
#   bash scripts/deploy-supabase.sh --secrets-only     # push secrets, skip deploy
#   bash scripts/deploy-supabase.sh --functions-only   # deploy, skip secrets
#   bash scripts/deploy-supabase.sh --skip-curl        # no post-deploy sanity check
#
# Idempotent: re-running deploys latest code, overwrites secrets, harmless.

set -euo pipefail

cd "$(dirname "$0")/.."  # repo root

# ─── parse flags ───────────────────────────────────────────────────────────
WITH_STRIPE=0
DO_SECRETS=1
DO_FUNCTIONS=1
DO_CURL=1
for arg in "$@"; do
  case "$arg" in
    --with-stripe)    WITH_STRIPE=1 ;;
    --secrets-only)   DO_FUNCTIONS=0 ;;
    --functions-only) DO_SECRETS=0 ;;
    --skip-curl)      DO_CURL=0 ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "✗ unknown flag: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

# ─── color helpers ─────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'; C_BLU=$'\033[34m'; C_DIM=$'\033[2m'; C_RST=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_YLW=''; C_BLU=''; C_DIM=''; C_RST=''
fi
say()  { echo "${C_BLU}▸${C_RST} $*"; }
ok()   { echo "${C_GRN}✓${C_RST} $*"; }
warn() { echo "${C_YLW}⚠${C_RST} $*"; }
fail() { echo "${C_RED}✗${C_RST} $*" >&2; exit 1; }

# ─── pre-flight ────────────────────────────────────────────────────────────
say "pre-flight checks"

command -v supabase >/dev/null 2>&1 || fail "supabase CLI not found. brew install supabase/tap/supabase"

if [ ! -f supabase/.temp/project-ref ]; then
  fail "project not linked. run: supabase link --project-ref <your-ref>"
fi
PROJECT_REF=$(cat supabase/.temp/project-ref)
ok "linked to project: ${PROJECT_REF}"

if [ "$DO_SECRETS" = "1" ]; then
  [ -f supabase/.env.production ] || fail "supabase/.env.production not found. cp supabase/.env.example supabase/.env.production and fill in values"
  if ! git check-ignore -q supabase/.env.production 2>/dev/null; then
    fail "supabase/.env.production is NOT gitignored — refuse to proceed. add it to supabase/.gitignore first"
  fi
  ok ".env.production exists and is gitignored"

  if [ "$WITH_STRIPE" = "0" ]; then
    if grep -qE '^STRIPE_(SECRET|PRICE|WEBHOOK)' supabase/.env.production 2>/dev/null; then
      warn ".env.production has Stripe vars but --with-stripe not set — they'll be pushed anyway (harmless if placeholders)"
    fi
  fi
fi

# ─── secrets ───────────────────────────────────────────────────────────────
if [ "$DO_SECRETS" = "1" ]; then
  say "pushing secrets from supabase/.env.production"
  supabase secrets set --env-file ./supabase/.env.production
  ok "secrets pushed"
  echo
  supabase secrets list
  echo
fi

# ─── functions ─────────────────────────────────────────────────────────────
NON_STRIPE_FUNCTIONS=(ai-proxy agent-run managed-models delete-library delete-topic)
STRIPE_FUNCTIONS=(create-checkout-session create-portal-session stripe-webhook)

if [ "$DO_FUNCTIONS" = "1" ]; then
  FUNCTIONS=("${NON_STRIPE_FUNCTIONS[@]}")
  if [ "$WITH_STRIPE" = "1" ]; then
    FUNCTIONS+=("${STRIPE_FUNCTIONS[@]}")
  else
    say "skipping Stripe functions: ${STRIPE_FUNCTIONS[*]}  (use --with-stripe when ready)"
  fi

  # --use-api: bundle on Supabase backend instead of local Docker. Required
  # behind GFW where Docker can't fetch esm.sh imports (CF 522). Harmless
  # otherwise — slightly slower than local bundling but always works.
  say "deploying ${#FUNCTIONS[@]} Edge Functions (server-side bundle via --use-api)"
  for fn in "${FUNCTIONS[@]}"; do
    if [ "$fn" = "stripe-webhook" ]; then
      # webhook auth is HMAC, not JWT — must skip JWT verification
      supabase functions deploy "$fn" --use-api --no-verify-jwt
    else
      supabase functions deploy "$fn" --use-api
    fi
    ok "deployed: $fn"
  done
fi

# ─── sanity check ──────────────────────────────────────────────────────────
if [ "$DO_CURL" = "1" ] && [ "$DO_FUNCTIONS" = "1" ]; then
  echo
  say "sanity-checking deployed functions (expect 401 — auth wall is alive)"
  BASE="https://${PROJECT_REF}.supabase.co/functions/v1"
  ALL_OK=1
  for fn in "${FUNCTIONS[@]}"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$BASE/$fn" || echo 000)
    case "$code" in
      401|403) ok  "$fn → $code (auth wall working)" ;;
      404)     warn "$fn → 404 (not deployed?)"; ALL_OK=0 ;;
      500|502|503) warn "$fn → $code (function boots but crashed — check logs at https://supabase.com/dashboard/project/${PROJECT_REF}/functions/$fn/logs)"; ALL_OK=0 ;;
      000)     warn "$fn → connection failed (network or proxy issue)"; ALL_OK=0 ;;
      *)       warn "$fn → $code (unexpected, inspect logs)"; ALL_OK=0 ;;
    esac
  done
  echo
  if [ "$ALL_OK" = "1" ]; then
    ok "all functions reachable and auth-walled — deploy verified"
  else
    warn "some functions returned non-401 — see notes above"
  fi
fi

# ─── summary ───────────────────────────────────────────────────────────────
echo
ok "${C_GRN}deploy complete${C_RST}"
echo "${C_DIM}  Dashboard: https://supabase.com/dashboard/project/${PROJECT_REF}${C_RST}"
echo "${C_DIM}  Functions: https://supabase.com/dashboard/project/${PROJECT_REF}/functions${C_RST}"
echo "${C_DIM}  Logs:      https://supabase.com/dashboard/project/${PROJECT_REF}/logs${C_RST}"
if [ "$WITH_STRIPE" = "0" ] && [ "$DO_FUNCTIONS" = "1" ]; then
  echo
  echo "${C_DIM}  Stripe deferred. When ready:${C_RST}"
  echo "${C_DIM}    1. Create Stripe products + get test price IDs${C_RST}"
  echo "${C_DIM}    2. Add STRIPE_* vars to supabase/.env.production${C_RST}"
  echo "${C_DIM}    3. bash scripts/deploy-supabase.sh --with-stripe${C_RST}"
  echo "${C_DIM}    4. Register webhook endpoint in Stripe Dashboard${C_RST}"
  echo "${C_DIM}       URL: https://${PROJECT_REF}.supabase.co/functions/v1/stripe-webhook${C_RST}"
  echo "${C_DIM}    5. Update STRIPE_WEBHOOK_SECRET with the value Stripe gives back${C_RST}"
fi
