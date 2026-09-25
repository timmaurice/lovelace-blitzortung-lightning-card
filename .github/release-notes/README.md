# Release notes

One file per release, named after the tag: `<version>.md`, for example `1.4.0.md` or `1.4.0-beta.1.md`. Commit it together with the version bump, so the tagged commit contains it. The release workflow reads it from the tag.

- **The first line is the title**, written as `# Title`. It becomes the release name. A title is a name, not a label: "Just the Stream, One Camera Again", not "Version 2.3.0".
- **Everything after the first line is the body.** Leading blank lines are dropped.

With the file in place, the workflow publishes the release as a pre-release, not as Latest. After testing, promote it with `gh release edit <tag> --prerelease=false --latest`. Without the file, the workflow creates a draft named after the tag, with an empty body. A re-pushed tag sets the title and body from the file again, so correct the file, not the release on GitHub.

## House style for the body

1. One lead paragraph that says in a sentence what this version is about.
2. `##` sections named after their topic. Do not use "Features" and "Fixes" as the skeleton; a closing _Fixes_ section is fine.
3. Each point is `- **A bold opening sentence.** Then the explanation`, and the explanation compares the change with the old behaviour.
4. Issue references as `_[#12]_`.
5. No generated changelog at the end.
6. A closing section for migration notes ("If you already have …").
7. No hard line breaks inside a paragraph.
