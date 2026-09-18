# Copilot instructions (skyfire-solutions-fastly-compute-news-crawler-demo)

## Dependabot auto-merge workflow

`.github/workflows/dependabot-auto-merge.yml` approves and queues patch and
minor Dependabot updates; anything else is labelled `needs-manual-review`.
The points below have each been raised in review, tested, and settled. Please do
not re-raise them without new evidence.

### The `pull_request` trigger is correct — do not suggest `pull_request_target`

Dependabot-triggered runs get a read-only `GITHUB_TOKEN` *by default*, but the
`permissions:` block is the documented override and does grant write. Verified:
`sky-dashboard` runs this workflow on `on: pull_request` and its PR #823
approved and merged itself (`reviews=[github-actions:APPROVED]`,
`mergedBy=app/github-actions`, run `35256421944`). Eight PRs merged in this repo
the same way.

This is also the trigger used by GitHub's own auto-merge recipe.

`pull_request_target` is actively worse here: this repo is public, so anyone can
open a PR, and that trigger runs them in the base-branch context with a write
token. It was tried in `9d7878b` and reverted. It also buys nothing — both
triggers need an `opened`/`synchronize`/`reopened` event to fire.

### Approval failures are a repository setting, not a token problem

If the approve step fails with `GitHub Actions is not permitted to approve pull
requests`, that is the repo policy **Allow GitHub Actions to create and approve
pull requests**, not an authorization failure. A read-only token fails
authorization on the call; it never reaches a check that names the approval
capability.

### Exempting Dependabot from the approval rule does not work

Tested on this repo and on `skyfire-solutions-crawler-template`: a ruleset with
`Integration:29110` (Dependabot) on the bypass list left its PRs `BLOCKED` /
`REVIEW_REQUIRED` with all checks green and zero reviews. `@dependabot merge`
produced no response. Auto-merge is performed by `github-actions[bot]`, which
GitHub does not offer as a bypass actor.

## CI workflow

`.github/workflows/ci.yml` runs every job on every pull request deliberately. Do
not suggest path filters: a job skipped by a path filter never reports a status,
and a required status check that never reports blocks the pull request forever.

`crawler-agent-fe` uses yarn; `crawler-agent-core` and `fastly` use npm. The
`fastly` job stops at `npm ci` because `fastly compute build` needs the Fastly
CLI in the runner.

## Dependabot config

`cooldown` is not supported for the `github-actions` ecosystem — GitHub's own
config validator rejects it. Do not suggest adding it there.

There is no `yarn` package-ecosystem; `npm` covers npm and yarn, which is why
Dependabot names its branches `dependabot/npm_and_yarn/...`.
