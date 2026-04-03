[2026-04-02 13:42] - Updated by Junie
{
    "TYPE": "negative",
    "CATEGORY": "preview not visible",
    "EXPECTATION": "The user expected to access and see the running web app interface via the provided preview/URL.",
    "NEW INSTRUCTION": "WHEN user says they can't see the app THEN provide exact URL, verify server/port, show step-by-step troubleshooting checks"
}

[2026-04-02 13:54] - Updated by Junie
{
    "TYPE": "preference",
    "CATEGORY": "graph spacing",
    "EXPECTATION": "User wants the dependency graph spaced out more to stay readable on big projects.",
    "NEW INSTRUCTION": "WHEN rendering large graphs or spacing requested THEN increase nodeRepulsion, idealEdgeLength, and padding"
}

[2026-04-02 14:12] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "uploaded files analysis",
    "EXPECTATION": "User wants guidance on analyzing dependencies of uploaded files within the app, not just running or previewing it.",
    "NEW INSTRUCTION": "WHEN user mentions analyzing uploaded files THEN explain upload flow and dependency analysis steps in-app"
}

[2026-04-02 14:23] - Updated by Junie
{
    "TYPE": "negative",
    "CATEGORY": "label size too large",
    "EXPECTATION": "Text should scale with node size but not become excessively large.",
    "NEW INSTRUCTION": "WHEN user says text too big THEN cap label font-size and lower scaling multiplier"
}

[2026-04-02 14:27] - Updated by Junie
{
    "TYPE": "correction",
    "CATEGORY": "safety scope clarification",
    "EXPECTATION": "User wants safety analysis focused on dependency safety like circular dependencies.",
    "NEW INSTRUCTION": "WHEN user mentions safety in this app THEN address dependency safety (cycles) first"
}

[2026-04-02 19:09] - Updated by Junie
{
    "TYPE": "negative",
    "CATEGORY": "tooltip not working",
    "EXPECTATION": "A tooltip should appear on hover over highlighted 'orphan' or 'god' items in the sidebar.",
    "NEW INSTRUCTION": "WHEN marking orphan/god in sidebar THEN ensure hover tooltip appears on .ref-name; test live"
}

