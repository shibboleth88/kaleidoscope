#!/usr/bin/env bash
# .claude/hooks/git-guard.sh — PreToolUse guard: git WRITES are the user's to run.
#
# WHY A HOOK AND NOT A DENY LIST. permissions.deny enumerates verbs, and an
# enumeration over git's command surface is leaky by construction: `git update-ref
# -d HEAD` deletes a branch ref without touching any of the 31 denied verbs, and
# that is exactly how an agent undid an unrequested commit in a downstream project.
# This guard inverts the default — a small allow-list of READ-ONLY verbs passes,
# everything else (known write, mixed-mode, or a verb git adds next year) is
# denied. Unknown fails CLOSED.
#
# Contract: PreToolUse JSON on stdin, JSON permission decision on stdout.
# Test:  echo '{"tool_input":{"command":"git commit -m x"}}' | .claude/hooks/git-guard.sh

set -uo pipefail

raw="$(cat)"

# FAIL CLOSED ON A MISSING DEP (boundary, 2026-08-30): with jq absent this guard used to
# exit 0 on every call — an installed guard that silently guards nothing. Without jq we
# cannot parse the envelope, so: a payload that plainly mentions git is DENIED with the
# remedy named; anything else passes (the guard's scope is git, and bricking every Bash
# call on an unrelated box is worse than the narrow deny).
if ! command -v jq >/dev/null 2>&1; then
  if printf '%s' "$raw" | grep -qi git; then
    printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"git-guard: jq is not installed, so the command envelope cannot be parsed — failing CLOSED for git-mentioning commands. Install jq (apt install jq) to restore the real allow-list."}}'
  fi
  exit 0
fi

cmd="$(printf '%s' "$raw" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0

# Verbs that cannot modify the repository, the index, the worktree, or refs.
READ_ONLY=" status log diff show rev-parse rev-list ls-files ls-tree ls-remote
  cat-file blame describe shortlog name-rev for-each-ref show-ref show-branch
  merge-base diff-tree diff-index check-ignore check-attr check-ref-format grep
  whatchanged cherry range-diff count-objects verify-commit verify-tag var
  version help difftool "

# A path is IN-TREE if it is relative, or absolute under the project root. Writing
# outside the tree (/tmp, /dev/null, an absolute path elsewhere) is not a revert.
in_tree() {
  local t="$1" root="${CLAUDE_PROJECT_DIR:-$PWD}"
  case "$t" in
    /dev/null|/dev/stdout|/dev/stderr) return 1 ;;
    /tmp/*|/var/tmp/*) return 1 ;;
    "$root"/*) return 0 ;;
    /*) return 1 ;;          # absolute, outside the project
    *) return 0 ;;           # relative — resolves inside the tree
  esac
}

# Find a redirect target in a segment: `> path`, `>> path`, or `| tee [-a] path`.
# Prints the target, or nothing.
redirect_target() {
  printf '%s' "$1" | sed -nE 's/.*[^0-9>]>>?[[:space:]]*([^[:space:]|;&>]+).*/\1/p' | head -1
}
tee_target() {
  printf '%s' "$1" | sed -nE 's/.*\|[[:space:]]*tee[[:space:]]+(-a[[:space:]]+)?([^[:space:]|;&]+).*/\2/p' | head -1
}

deny() {
  jq -nc --arg r "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
  exit 0
}

# THREAT MODEL. This guards against an agent running a git write without
# thinking — an honest-mistake net, not an adversarial sandbox. It is why heredoc
# BODIES are stripped below: writing a file that documents `git commit` is not
# running it, and denying that made the guard unusable. Heredocs fed to a shell
# interpreter are NOT stripped, since there the body is code. A determined bypass
# is still possible (that is what the permissions deny list backstops); an
# accidental `git push` is not.
strip_heredocs() {
  local line delim='' inbody=0
  while IFS= read -r line; do
    if [ "$inbody" -eq 1 ]; then
      case "$line" in
        "$delim"|*[[:space:]]"$delim") inbody=0 ;;
      esac
      continue
    fi
    # `cmd <<EOF`, `<<'EOF'`, `<<-"EOF"` — capture the delimiter word.
    if [[ "$line" =~ \<\<-?[[:space:]]*[\'\"]?([A-Za-z_][A-Za-z0-9_]*)[\'\"]? ]]; then
      # Read the capture NOW — the interpreter test below overwrites BASH_REMATCH.
      local found="${BASH_REMATCH[1]}"
      # A body piped into a shell IS code — keep scanning it.
      if ! [[ "$line" =~ ^[[:space:]]*(bash|sh|zsh|dash|ksh|eval|source|\.)[[:space:]] ]]; then
        delim="$found"
        inbody=1
      fi
    fi
    printf '%s\n' "$line"
  done
}
cmd="$(printf '%s\n' "$cmd" | strip_heredocs)"
raw_cmd="$cmd"   # pre-split copy — segment splitting eats the `|` that `tee` needs

# Split on shell operators and command substitution so every git invocation in a
# compound command is inspected independently — `ls && git push` must not pass
# because it starts with `ls`.
segments="$(printf '%s' "$cmd" \
  | sed -E 's/\$\(/\n/g; s/`/\n/g; s/\)/\n/g; s/\{/\n/g; s/\}/\n/g' \
  | sed -E 's/&&/\n/g; s/\|\|/\n/g; s/\|/\n/g; s/;/\n/g; s/&/\n/g')"

while IFS= read -r seg; do
  # shellcheck disable=SC2086
  set -- $seg
  # Step past wrappers and VAR=value prefixes to reach the real command word.
  while [ $# -gt 0 ]; do
    case "$1" in
      *=*) shift ;;                                   # FOO=bar git ...
      env|sudo|nohup|time|command|builtin|exec|nice|ionice|xargs|then|do|else|elif|if|while|until) shift ;;
      -*) shift ;;                                    # flags belonging to the wrapper
      *) break ;;
    esac
  done
  [ $# -gt 0 ] || continue
  case "$1" in
    git|*/git) ;;
    *) continue ;;
  esac
  shift

  # Step past git's GLOBAL options to find the subcommand.
  while [ $# -gt 0 ]; do
    case "$1" in
      -C|-c|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix)
        shift 2 || true ;;                            # option with a separate value
      --git-dir=*|--work-tree=*|--namespace=*|--exec-path=*|-c*|--config-env=*)
        shift ;;
      -P|--no-pager|--paginate|--bare|--no-replace-objects|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks)
        shift ;;
      -*) deny "git-guard: unrecognized global option \`$1\` before the subcommand — refusing to guess. Run this yourself if you meant it." ;;
      *) break ;;
    esac
  done

  # Bare `git` (or `git --version` style already consumed) prints help.
  [ $# -gt 0 ] || continue
  sub="$1"; shift

  case " $sub " in
    *" $sub "*) : ;;
  esac
  if [[ "$READ_ONLY" == *" $sub "* ]]; then
    # A git READ whose output is redirected into the working tree is a git-mediated
    # WRITE — `git show HEAD:path > path` reverts a file without touching a single
    # denied verb, which is how work actually gets silently undone. Redirects that
    # leave the tree (/tmp, /dev/null, elsewhere) are ordinary reads and pass.
    # NOTE: this covers the GIT-mediated case only. cp / sed -i / tee / a python
    # open(...,"w") reach the working tree without git and are out of scope here —
    # that is Edit/Write path rules, a broader policy decision.
    tgt="$(redirect_target "$seg")"
    [ -n "$tgt" ] || tgt="$(tee_target "$raw_cmd")"
    if [ -n "$tgt" ] && in_tree "$tgt"; then
      deny "git-guard: \`git $sub … > $tgt\` writes git content over a file in the working tree — that is a revert, not a read. Use Edit/Write so the change is visible, or run it yourself."
    fi
    continue
  fi

  # Mixed-mode verbs: a read-only invocation is allowed, anything else is not.
  args="$*"
  case "$sub" in
    branch)
      # Listing only. A positional arg CREATES a branch — unless an explicit
      # --list/-l is present, which makes positionals glob patterns to filter by.
      listing=0
      for a in "$@"; do case "$a" in -l|--list) listing=1 ;; esac; done
      for a in "$@"; do
        case "$a" in
          -l|--list|-a|--all|-r|--remotes|-v|-vv|--verbose|--show-current|--merged|--no-merged|--contains|--no-contains|--sort=*|--format=*|--color|--no-color|--column|-i|--ignore-case) ;;
          -*) deny "git-guard: \`git branch $args\` can modify refs. Branch changes are yours to run." ;;
          *) [ "$listing" -eq 1 ] || deny "git-guard: \`git branch $args\` would create or act on a branch. Yours to run." ;;
        esac
      done
      ;;
    tag)
      listing=0
      for a in "$@"; do case "$a" in -l|--list|-n|-n[0-9]*) listing=1 ;; esac; done
      for a in "$@"; do
        case "$a" in
          -l|--list|-n|-n[0-9]*|--sort=*|--format=*|--contains|--no-contains|--merged|--no-merged|--points-at|--color|--no-color|-i|--ignore-case) ;;
          -*) deny "git-guard: \`git tag $args\` can create or delete tags. Yours to run." ;;
          *) [ "$listing" -eq 1 ] || deny "git-guard: \`git tag $args\` would create or act on a tag. Yours to run." ;;
        esac
      done
      ;;
    stash)   [ "${1:-}" = "list" ] || [ "${1:-}" = "show" ] || deny "git-guard: only \`git stash list\`/\`show\` are read-only; \`git stash $args\` moves your work." ;;
    notes)   [ "${1:-}" = "list" ] || [ "${1:-}" = "show" ] || deny "git-guard: only \`git notes list\`/\`show\` are read-only; \`git notes $args\` writes." ;;
    worktree) [ "${1:-}" = "list" ] || deny "git-guard: only \`git worktree list\` is read-only; \`git worktree $args\` changes the tree." ;;
    submodule) { [ "${1:-}" = "status" ] || [ "${1:-}" = "summary" ]; } || deny "git-guard: only \`git submodule status\`/\`summary\` are read-only; \`git submodule $args\` writes." ;;
    remote)  { [ $# -eq 0 ] || [ "${1:-}" = "-v" ] || [ "${1:-}" = "show" ] || [ "${1:-}" = "get-url" ]; } || deny "git-guard: \`git remote $args\` reconfigures remotes. Yours to run." ;;
    reflog)
      case "${1:-}" in
        expire|delete|drop) deny "git-guard: \`git reflog $args\` destroys the reflog — the last safety net for a bad rewrite. Yours to run." ;;
      esac
      ;;
    config)
      case "$args" in
        *--get*|*--list*|-l*) ;;
        *) deny "git-guard: \`git config $args\` writes configuration. Yours to run." ;;
      esac
      ;;
    symbolic-ref)
      # One ref argument reads; two writes (`git symbolic-ref HEAD refs/heads/x`).
      pos=0
      for a in "$@"; do
        case "$a" in
          -d|--delete|-m|--short|-q|--quiet) case "$a" in -d|--delete) deny "git-guard: \`git symbolic-ref $args\` deletes a ref. Yours to run." ;; esac ;;
          -*) ;;
          *) pos=$((pos+1)) ;;
        esac
      done
      [ "$pos" -le 1 ] || deny "git-guard: \`git symbolic-ref $args\` rewrites where a ref points. Yours to run."
      ;;
    *)
      deny "git-guard: \`git $sub\` is not on the read-only allow-list, so it is treated as a write. Git writes (commits, refs, history, remotes) are the user's to run — ask, or leave the change in the working tree."
      ;;
  esac
done <<< "$segments"

exit 0
