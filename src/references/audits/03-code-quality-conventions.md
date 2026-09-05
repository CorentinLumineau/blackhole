---
section: Code Quality & Conventions
vcodes: [V-SOLID-01, V-SOLID-02, V-SOLID-03, V-SOLID-04, V-SOLID-05, V-DRY-01, V-DRY-02, V-DRY-03, V-DRY-04, V-KISS-02, V-KISS-03, V-YAGNI-02, V-YAGNI-03, V-PAT-01, V-PAT-02, V-PAT-03, V-PAT-04]
---
### Code Quality & Conventions
*   **SOLID & DRY Compliance**:
    *   No duplicated code blocks >10 lines (`V-DRY-01`).
    *   Single Responsibility Principle (SRP) followed (functions/classes have only one reason to change) (`V-SOLID-01`).
    *   Liskov Substitution followed — no override/subclass narrows a base type's accepted
        inputs, widens the exceptions it throws, or otherwise breaks a caller's ability to
        substitute the subtype without knowing the difference (`V-SOLID-03`).
    *   Open/Closed Principle (`V-SOLID-02`) — flag switch/if-else chains branching on a type
        tag that must be edited for every new variant when extension is viable; cross-reference
        `hunt/best-practices.md` § Scan heuristics (OCP trigger), do not restate the calibration
        table (`V-INT-02`).
    *   Interface Segregation (`V-SOLID-04`, `WARN`) — flag interfaces/abstract classes with
        >7 methods where implementers stub or no-op unused members. Cross-reference
        `hunt/best-practices.md` § Scan heuristics (ISP trigger); do not restate the calibration
        table (`V-INT-02`).
    *   Dependency Inversion (`V-SOLID-05`) — flag direct concrete instantiation (e.g.
        `new ConcreteClient()`) inside business logic instead of constructor/parameter injection
        of an abstraction; cross-reference `hunt/best-practices.md` § Scan heuristics (DIP
        trigger), do not restate the calibration table (`V-INT-02`).
    *   3–10-line duplication left unextracted (`V-DRY-02`, `WARN`) and repeated magic
        values/constants left unnamed (`V-DRY-03`, `WARN`) flagged for cleanup, not blocked.
*   **Anti-Slop Audit**:
    *   `V-KISS-02` (Deep nesting): Flag changed functions with nesting depth >4 levels (nested
        if/for/try/callback chains) — mercure parity heuristic.
    *   `V-KISS-03` (Empty scaffolding): Reject empty catch blocks, pass-through helper functions, or empty boilerplate scaffolding.
    *   `V-YAGNI-02` (Premature optimization): Flag caching, memoization, or indexing added
        without measured hot-path evidence or profiling data cited in the PR or plan.
    *   `V-YAGNI-03` (Single-consumer abstraction): Reject interfaces or factories designed for only a single class/implementation.
    *   `V-DRY-04` (Template copy-paste): Reject files duplicated with only name replacements.
*   **Design Pattern Review**: No God Objects (`V-PAT-01`), no circular dependencies between
    modules (`V-PAT-02`), no missing/swallowed error-handling pattern (`V-PAT-03`), no
    anti-pattern usage — singleton abuse, service locator (`V-PAT-04`).
