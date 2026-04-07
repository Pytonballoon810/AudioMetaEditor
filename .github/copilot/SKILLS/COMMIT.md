# COMMIT Skill

Use this skill when the user asks to create commits.

## Objective

Create clean, reviewable commits that preserve intent, and keep release versioning consistent between `package.json` and Git tags.

## Mandatory Behavior

1. Prefer multiple small commits over one large mixed commit.
2. Split by feature/fix area whenever possible.
3. Keep docs/process changes separate from runtime behavior changes when feasible.
4. Use non-interactive git commands.
5. Do not amend existing commits unless explicitly asked.

## Commit Splitting Policy

When there are many changed files or multiple implemented features:

1. Group files by cohesive intent (for example: workflow changes, docs changes, UI behavior, backend behavior).
2. Stage and commit each group separately.
3. Ensure each commit is independently understandable and reasonably buildable.
4. Keep commit messages scoped and action-oriented.

Preferred commit sequence when relevant:

1. Runtime or feature behavior
2. Tests for that behavior
3. Docs/changelog updates
4. Release/version metadata

## Version and Tag Consistency Rules

Always check whether `package.json` version changes are present and whether a tag exists or is requested.

### Case A: `package.json` version changed

1. Ensure the version bump is committed in its own commit or a clearly scoped release-metadata commit.
2. Create a matching tag for that commit (for example version `1.2.3` -> tag `v1.2.3`) unless the user explicitly requests a different tag format.
3. If a matching tag already exists, do not create a duplicate tag; report it.

### Case B: A new release tag is requested/created

1. Verify `package.json` has the matching version for the tag.
2. If not matching, update `package.json`, commit the version change, and then create the tag on that version commit.

### Case C: Neither version bump nor tag is part of user intent

1. Do not create or move tags.
2. Do not change `package.json` version.

## Required Checks Before Finishing

1. `git status --short` shows only expected remaining changes.
2. Commits are split by intent when applicable.
3. If a version commit exists, tag/version alignment is verified.
4. Report commit SHAs and tag name (if created) to the user.

## Example Attribution-Style Output To User

- `Created 3 commits: <sha1> (workflow), <sha2> (docs), <sha3> (release metadata).`
- `Created tag v1.0.1 on <sha3> to match package.json version 1.0.1.`
