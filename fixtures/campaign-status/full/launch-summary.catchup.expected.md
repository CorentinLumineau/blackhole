## Launch summary

| Section | Now | Consequence |
|---------|-----|-------------|
| Scope | acme/widgets · milestone **v2.0** · 2 ready / 3 blocked / 6 in flight · 9 open issues / 6 open PRs | The campaign works only these issues; anything outside the filter is left alone. |
| Order | bugs first, then Pareto priority · stacking on | Bugs land before features; a PR that overlaps another stacks on it instead of waiting. |
| Merge | leave-open · you merge | Every PR is driven to LGTM and left open for you to review and merge. |
| Pacing | plan max · weekly 30% (resets Mon 16 Nov 09:30 UTC) · floor 45.71% (96 h / 168 h x 80%) · shortfall 15.71% · 5h caps 75/80 · lane unset | Spends about 15.71 points of weekly quota on backlog work and stops at 45.71%; 5h spawns stop at 75%, workers at 80%. |
| Budget | GO · 5h 40% (resets Fri 13 Nov 13:30 UTC) · weekly 30% (resets Mon 16 Nov 09:30 UTC) · 1 worker allowed · stops 5h 75/80%, weekly 45.71% · forecast 0.31%/h, weekly stop Sun 15 Nov 11:46 UTC | 1 worker starts now; spawning stops at 5h 75%, the campaign at weekly 45.71%. |
| Status page | https://claude.ai/code/artifact/abc · reachable (probed 5 min ago) · template v4 | The stored page opens from this account and is refreshed at every checkpoint. |
| Kaizen and staging | kaizen off · staging carry on | No improvement hunts run; staged docs carry into each PR. |
| Autonomy | mode full · confidence threshold 80 · design autonomy on · 3 never-bypass triggers | Design approvals, split sign-offs, plan waivers and BLOCK remedies are decided without asking you. |
| Resource policy | absent: defaults | The resource gate defers a batch below 2500 MB free memory; the test-lock wrapper is mandatory. |
| Wave scheduling | absent: defaults | No path sharding or hot-file lock: parallel workers may collide on shared files. |
| Peers | solo | This session spends the usage budget alone; no other session is coordinated. |
| Decisions | park (default) · none waiting | Gates park their questions; /blackhole decide asks them all, most-blocking first. This launch gate still asks. |
| Other config | campaign_scope, display_targets, forge, target_branch | Keys no row above shows, by name only; their values are not printed. |
