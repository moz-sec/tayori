# Agent Instructions

Please provide all answers in Japanese.

## Browser Verification

- Use Agent Browser for interactive browser checks during implementation and debugging. It is installed as a development
  dependency of `@tayori/app`.
- Continue to use the existing Playwright E2E tests for automated regression checks and CI.

## Documentation

- Do not create new documentation files, add information to existing documents in `docs/`.

## Markdown Proofreading

- If you create a new Markdown file or make changes to an existing one, be sure to read
  `.agents/skills/yomiyasu/SKILL.md` at the end of your work and proofread the modified text according to the yomiyasu
  skill’s instructions. This is required even if not specifically requested by a user.
- When proofreading, preserve the meaning, conditions, and degree of obligation, and do not modify code blocks,
  commands, URLs, or identifiers.
- If you make changes to the Markdown after proofreading, proofread it again using yomiyasu and complete your work only
  after verifying that it matches the final draft.
- In your completion report, include the proofread file and the results of the checks you ran. If you were unable to
  perform the proofreading or checks, clearly state the reason and do not treat the document as proofread.

## Pull Requests and Issues

- Before creating or updating a PR, read `.github/PULL_REQUEST_TEMPLATE.md` and write the body text following its
  structure.
- Before creating or updating an issue, select a template from `.github/ISSUE_TEMPLATE/` that matches the content and
  write the body text following its structure.
- Write the titles and body text of PRs and issues in Japanese.
- In your verification report, describe the actions you actually took and the results. If an action was not performed,
  clearly state the reason.
- Do not fill in missing information with guesses.

## Commit Attribution

When Codex creates a commit containing changes it authored or co-authored, append
the following trailer to the commit message, separated from the body by a blank
line:

```text
Co-authored-by: Codex <codex@openai.com>
```

Preserve this trailer when preparing a squash commit message.

## CodeRabbit Review

After creating a pull request, review CodeRabbit feedback and make the corresponding changes.
