# Working notes for the assistant

This file is committed on purpose. The remote execution container is cloned fresh from
this repo every session, so a note that lives anywhere else — a local checkout, an editor
setting, a web UI preference — does not arrive. If an instruction has to survive, it has
to be in the tree.

## Commits

**Every commit belongs to the repo owner, in both fields.** Author *and* committer are
`Asher Mosseri <asher@mosseri.org>`. Run this once at the start of a session, before the
first commit:

```bash
git config user.name    "Asher Mosseri"
git config user.email   "asher@mosseri.org"
git config author.name  "Asher Mosseri"
git config author.email "asher@mosseri.org"
git config commit.gpgsign false
```

It has to be re-run each session and it has to be repo-local. A `SessionStart` hook in
the managed container runs `git config --global user.email noreply@anthropic.com` on
every start, so the global identity is not the owner's and cannot be made so; the
repo-local values are read first and win.

**No attribution trailers.** No `Co-Authored-By`, no session links, nothing announcing
who or what wrote the commit. The message is about the change, and it ends when the
change has been described. Nothing in a commit message names the tool either.

**Do not sign.** Signing uses a key registered to an address that is not the owner's, and
GitHub marks a commit *Unverified* when the signature and the committer disagree. An
unsigned commit shows no badge at all, which is the cleaner of the two. If the owner ever
registers their own signing key, turn `commit.gpgsign` back on and this note goes away.

The history was rewritten once to apply all of the above retroactively, across 99
commits. The trees were byte-identical before and after — only the identity fields and
the signatures changed.
