---
name: release
description: Cut a Hearth release - bump the version, commit, tag vX.Y.Z, push so CI builds it, wait for CI and publish the GitHub release. Use when the user types /release or asks to release.
---

# Release

Arguments (optional): `patch`, `minor` (default), `major`, or an explicit version like `0.7.0`. Add `draft` to stop
after CI and leave the GitHub release as a draft.

1. Make sure you are on `main` (`git branch --show-current`). If not, stop and tell the user.
2. If the working tree has changes, ship them first, exactly like the `ship` skill: `pnpm typecheck && pnpm build`
   (stop on errors), read the diff, commit with a subject + `-` bullets per user-visible change and the attribution
   line from the current attribution system-reminder. Don't ask which files to include.
3. Work out the new version from `package.json` `version` and the argument (`minor`: 0.6.0 -> 0.7.0, `patch`:
   0.6.0 -> 0.6.1, `major`: 0.6.0 -> 1.0.0). Check that the tag `v<new>` doesn't exist locally or on origin
   (`git ls-remote --tags origin v<new>`); if it does, stop.
4. Bump the version in both places:
   - `package.json`: `"version": "<new>"`
   - `android/app/build.gradle`: `versionName '<new>'` and `versionCode` + 1
5. Run `pnpm build` again so `out/` carries the new version.
6. Commit only those two files with the subject `Release <new>` and the attribution line (`git commit -F -` with a heredoc).
7. Tag: `git tag -a v<new> -m "Release <new>"`.
8. `git push origin main`, then `git push origin v<new>`. If a push is rejected, don't force it. Report and stop.
9. The tag push starts the `Build` workflow (`.github/workflows/build.yml`); its `release` job creates a draft
   GitHub release. Find the run for the tag (`gh run list --workflow build.yml --branch v<new> --limit 1`, retry for
   up to a minute until it shows up) and wait for it in the background:
   `gh run watch <id> --exit-status --interval 30` with `run_in_background: true`. Tell the user CI is running and
   don't poll.
10. When it finishes:
    - Failed: show the failing job's log tail (`gh run view <id> --log-failed | tail -60`), leave the draft alone and stop.
    - Succeeded: check that `gh release view v<new> --json isDraft,assets` lists the Linux `.deb` and `.AppImage`, the mac `.dmg`/`.zip`,
      the Windows `.exe`, `hearth-android.apk` and `latest*.yml` (in-app updates need the yml files). If something is
      missing, say what and stop without publishing.
    - Unless `draft` was given: `gh release edit v<new> --draft=false`, then confirm with
      `gh api repos/zmilojevic/hearth/releases/latest --jq .tag_name`.
11. Report: commit hashes and subjects, the tag, the CI result, the release URL and whether it is published or still a draft.
