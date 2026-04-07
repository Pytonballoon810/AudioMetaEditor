#!/usr/bin/env bash

# ============================================================================
# build-release-body-from-changelog.sh
# ============================================================================
#
# Purpose:
# - Build a GitHub release body from a Markdown changelog.
# - Intended for CI usage in the release workflow.
#
# Expected behavior:
# 1) Try to extract the changelog section for the exact tag name.
#    Example: tag "v1" matches headings like:
#    - "## [v1]"
#    - "## [v1] - 2026-04-03"
# 2) If the tag section does not exist, fall back to "Unreleased".
# 3) If neither section exists, fail fast with a clear error.
# 4) Write a compact release body to the requested output file.
#
# Why this script exists:
# - Keeps the workflow YAML short and readable.
# - Centralizes parsing logic in one maintainable location.
# - Makes local testing easier by running this script directly.
#
# Usage:
#   bash .github/scripts/build-release-body-from-changelog.sh \
#     CHANGELOG.md v1 release-body.md
#
# Arguments:
#   $1 -> changelog file path
#   $2 -> tag name to look up (for example: v1, v1.0.0)
#   $3 -> output file path for release body markdown
#
# Exit codes:
# - 0 on success
# - non-zero on any validation/parsing failure
#
# Notes on parser design:
# - We intentionally parse by heading boundaries that start with "## [".
# - We intentionally avoid brittle exact-line matching that would break when
#   a date suffix is present in the heading.
# - We intentionally keep dependencies to standard shell tooling only.
#
# ============================================================================

set -euo pipefail

# ----------------------------------------------------------------------------
# Input validation
# ----------------------------------------------------------------------------

if [[ "$#" -ne 3 ]]; then
  echo "Usage: $0 <changelog-file> <tag-name> <output-file>"
  exit 2
fi

changelog_file="$1"
target_tag="$2"
output_file="$3"

if [[ ! -f "${changelog_file}" ]]; then
  echo "Changelog file not found: ${changelog_file}"
  exit 1
fi

# ----------------------------------------------------------------------------
# Helper: extract_section
# ----------------------------------------------------------------------------
# Extracts lines under a heading in the format:
#   ## [section_name]
# or
#   ## [section_name] - YYYY-MM-DD
#
# Extraction stops at the next heading that starts with "## [".
#
# Important behavior details:
# - "index($0, heading_prefix) == 1" means the current line starts with the
#   exact heading prefix, allowing date suffixes and still matching correctly.
# - We "next" after matching heading line so the heading itself is excluded
#   from the section body content.
# - If no section is found, this function returns an empty string.
# ----------------------------------------------------------------------------
extract_section() {
  local section_name="$1"
  awk -v heading_prefix="## [${section_name}]" '
    index($0, heading_prefix) == 1 { in_section = 1; next }
    in_section && /^## \[/ { exit }
    in_section { print }
  ' "${changelog_file}"
}

# ----------------------------------------------------------------------------
# Extraction strategy
# ----------------------------------------------------------------------------
# Priority:
# 1) Tag section (for example [v1])
# 2) Unreleased section
#
# We trim repeated blank lines for cleaner release notes output.
# ----------------------------------------------------------------------------

section_content="$(extract_section "${target_tag}" | sed '/^[[:space:]]*$/N;/^\n$/D')"
used_section="${target_tag}"

if [[ -z "${section_content}" ]]; then
  section_content="$(extract_section "Unreleased" | sed '/^[[:space:]]*$/N;/^\n$/D')"
  used_section="Unreleased"
fi

if [[ -z "${section_content}" ]]; then
  echo "Unable to find changelog section for [${target_tag}] or [Unreleased] in ${changelog_file}."
  exit 1
fi

# ----------------------------------------------------------------------------
# Emit output markdown
# ----------------------------------------------------------------------------
# The resulting file is consumed by release publishing actions (body_path).
# We include the source section metadata to make the generated notes auditable.
# ----------------------------------------------------------------------------

{
  echo "## Changelog"
  echo
  echo "Source section: [${used_section}]"
  echo
  echo "${section_content}"
} > "${output_file}"

echo "Wrote release body to ${output_file} from section [${used_section}]."