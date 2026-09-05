## Context-Anxiety Countermeasures

When in the second half of a complex implementation:

- **Increase verification rigor**, not decrease it — late-stage shortcuts cause the most
  regressions.
- **Never skip a phase or checkpoint** because context is filling — checkpoint via the
  progress file and hand off to a fresh session instead.
- **Never combine or batch remaining tasks** "for efficiency" — the urge to batch is a signal
  to slow down, not speed up.
- **Red flag phrases**: "let me quickly wrap up", "I'll handle the rest together", "just the
  finishing touches" — same category of unverified-claim risk as the banned phrase list above.

---
