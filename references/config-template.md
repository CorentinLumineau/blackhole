# Campaign Config Template

Committed template: `.backlog-campaign/config.json`

```json
{
  "repo": "CorentinLumineau/invest-portfolio",
  "target_branch": "main",
  "forge": "github",
  "parallel_max": 4,
  "scratchpad_dir": "/tmp/invest-portfolio-campaign",
  "model": "composer-2.5",
  "runbook": "documentation/runbooks/backlog-campaign-cursor.md",
  "size_label_prefix": "size:",
  "default_touch_paths": ["lib/**", "app/**", "components/**"],
  "issue_labels": {
    "campaign": "campaign/backlog"
  },
  "auto_sync": true,
  "entry_mode": "multitask"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `repo` | yes | `owner/name` for `gh` |
| `target_branch` | yes | Merge target (usually `main`) |
| `forge` | yes | `github` (only supported v2) |
| `parallel_max` | no | Max parallel workers (default 4) |
| `scratchpad_dir` | no | Parent dir for git worktrees |
| `model` | yes | Only `composer-2.5` for this campaign |
| `runbook` | yes | Binding runbook path |
| `user_queue_order` | no | Override order; else FIFO by issue number |
| `auto_sync` | no | When `true` (default), forge reconcile runs automatically |
| `entry_mode` | no | `multitask` (default) — coordinator + orchestrator; `direct` = legacy single session |

On first bootstrap, copy template to runtime if missing fields — do not
overwrite existing runtime config without user confirmation.
