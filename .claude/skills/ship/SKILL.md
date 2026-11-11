---
name: ship
description: Commit all uncommitted changes in one commit and push it to origin main. Use when the user types /ship or asks to ship.
---

# Ship

Commit the whole working tree and push it to `origin main`. Don't ask which files to include.

1. Run `git status --short` and `git diff --stat`. If nothing changed, say so and stop.
2. Make sure you are on `main`. If you are on another branch, stop and tell the user.
3. Run `pnpm typecheck && pnpm build`. If either fails, show the errors and stop. Don't commit.
4. Read the diff (`git diff`, plus any untracked files) and write a commit message:
   - A short subject line that names the main changes.
   - A blank line, then a few `-` bullets, one per user-visible change.
   - End it with the attribution line from the current attribution system-reminder, if one is present.
5. `git add -A`, then commit with the message passed through a heredoc (`git commit -F -`).
6. `git push origin main`. If the push is rejected, don't force it. Report the error and stop.
7. Report the commit hash and subject, and list the changes it contains.
