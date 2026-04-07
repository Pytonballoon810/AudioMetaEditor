# MERGE_BRANCH Skill

Use this skill when the user asks to merge a branch into `main`.

## Objective

Merge a branch to `main` while preserving commit history and immediately write contributor attribution into `CHANGELOG.md`.

## Mandatory Behavior

1. Always preserve history.
2. Never squash merge.
3. Never rebase merge.
4. Use a merge commit strategy (`--no-ff`) when merging into `main`.
5. Immediately update `CHANGELOG.md` in the same flow after merge.

## Merge Policy

- Target branch: `main`
- Allowed merge mode: merge commit only
- Required git behavior:
	- Fetch latest refs.
	- Ensure working tree is clean or user-approved for merge work.
	- Switch to `main`.
	- Pull latest `main`.
	- Merge source branch with `git merge --no-ff <source-branch>`.

If there are conflicts, stop and ask the user how to proceed.

## Required Changelog Attribution

After the merge succeeds, add an attribution line in `CHANGELOG.md` under `## [Unreleased]`.

Format (required):

`- brief description of what the branch implemented - ~ [@user](https://github.com/user)`

Rules:

- The description must summarize user-visible outcome in one short line.
- `@user` must match the helper/contributor username.
- The username must be a clickable GitHub profile link.
- Add attribution immediately; do not defer to a later PR.

## Example Attribution Lines

- `- Added release-body generation from changelog sections in release workflow - ~ [@octocat](https://github.com/octocat)`
- `- Improved metadata cover import feedback and toolbar reliability - ~ [@example-user](https://github.com/example-user)`

## Completion Checklist

1. Merge commit created on `main` with history preserved.
2. `CHANGELOG.md` updated with attribution line under `Unreleased`.
3. Changelog entry committed/pushed with the merge result.
4. Share final summary with merge commit SHA and changelog update note.
