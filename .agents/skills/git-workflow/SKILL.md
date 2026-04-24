---
name: git-workflow
description: Git workflow guidelines for a strict multi-branch development process. Use when managing branches, creating pull requests, or following the defined branching strategy. Triggers on "git checkout", "git pull", "git branch", "git commit", "git push", "git merge", "git rebase".
---

## Context

This project follows a strict multi-branch workflow.

## Branches

- main → production
- testing → staging
- development → integration
- feature/\* → isolated work

## Rules

- Never commit to main/testing/development
- Always branch from development
- Always use PR flow:
  feature → development → testing → main

## Allowed Commands Flow

1. switch to development
2. pull latest
3. create feature branch
4. commit & push
5. open PR

## Forbidden Actions

- direct push to main
- skipping PRs
- branching from main

## AI Behavior

- Validate current branch before acting
- Suggest next step after each action
- Warn on wrong flow
