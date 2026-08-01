# Working notes for Claude

This file is committed on purpose. The remote execution container is cloned fresh from
this repo every session, so a note that lives anywhere else — a local checkout, an editor
setting, a web UI preference — does not arrive. If an instruction has to survive, it has
to be in the tree.

## Commits

**No attribution trailers.** No `Co-Authored-By`, no `Claude-Session` link, nothing
announcing who or what wrote the commit. The message is about the change, and it ends
when the change has been described.

**Author every commit as the repo owner.** Run this once at the start of a session,
before the first commit:

```bash
git config author.name  "Asher Mosseri"
git config author.email "asher@mosseri.org"
```

It has to be re-run each session and it has to be repo-local. A `SessionStart` hook in
the managed container runs `git config --global user.email noreply@anthropic.com` on
every start, so the global identity is not yours and cannot be made yours; `author.*` is
read after it and applies to the author field only.

**Leave the committer alone.** It stays `Claude <noreply@anthropic.com>`, because the SSH
signing key is registered to that address and GitHub reports a commit whose committer is
anyone else as *Unverified* — `unknown_key` — however valid the signature actually is.
Author is the person the work belongs to; committer is the machine that typed it. Git
keeps two fields for exactly this, and using both is what makes the history honest
without breaking verification.
