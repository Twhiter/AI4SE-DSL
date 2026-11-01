# Care allowance: claude-sonnet-5-5 and gpt-6.1-sol

The same care allowance process description, modelled from an empty document in the web editor's chat on
1 November 2026, once with each model. Skills and options were on, and both agents reasoned at effort low. Times are UTC.

## The runs

| | claude-sonnet-5-5 | gpt-6.1-sol |
|---|---|---|
| Sessions | 2: session 1 (`82997c64`, 12:12–12:47) from empty, stopped by two 500s; session 3 (`cfc48a39`, 13:36–14:29) continued from its last document (64 lines) and finished | 1: `3fed2efb` (16:40–17:53), from empty to the end |
| Time | 35 + 53 = 87 min | 73 min |
| Errors | two 500s (session 1); twice `simulate_plan` called with no arguments (session 3) | none |
| User messages (typed / by a button) | 33 (15 / 18) | 37 (25 / 12) |

The 500s came from the chat's memory compacted by the OpenAI API, into an item Claude cannot read; Claude now compacts
it itself. A second session (`23ff6d3b`) also continued from session 1 and was stopped by a 500 too; it is left out.

## Files

| | claude-sonnet-5-5 | gpt-6.1-sol |
|---|---|---|
| DSL | [care_allowance.easy](claude-sonnet-5-5/care_allowance.easy) | [care_allowance.easy](gpt-6.1-sol/care_allowance.easy) |
| DCR Solutions XML (dcrgraphs.net) | [care_allowance - DCR Solutions.xml](claude-sonnet-5-5/care_allowance%20-%20DCR%20Solutions.xml) | [care_allowance - DCR Solutions.xml](gpt-6.1-sol/care_allowance%20-%20DCR%20Solutions.xml) |
| Session logs (to read) | [session 1](claude-sonnet-5-5/session-82997c64-076c-4cfd-b18e-2536648b89e6.md), [session 3](claude-sonnet-5-5/session-cfc48a39-c684-44b3-80bf-9ce04063eb58.md) | [session](gpt-6.1-sol/session-3fed2efb-e6d7-4b4f-b79e-ea375b6c9e2f.md) |
| Session data | [session 1](claude-sonnet-5-5/session-82997c64-076c-4cfd-b18e-2536648b89e6.json), [session 3](claude-sonnet-5-5/session-cfc48a39-c684-44b3-80bf-9ce04063eb58.json) | [session](gpt-6.1-sol/session-3fed2efb-e6d7-4b4f-b79e-ea375b6c9e2f.json) |

## How the plans went

Computed with `packages/chatbot/src/experiment/metrics.ts` over the plans of the session data, Claude's two sessions
together. A simulation of an empty plan is not an attempt; a call of `simulate_plan` whose input was rejected is a failed
attempt. (The logs' own tables were computed when they were written: the GPT log counts its empty plans, 14/36 and 1.72.)

| Metric | claude-sonnet-5-5 | gpt-6.1-sol |
|---|---|---|
| Plans | 46 (14 + 32) | 36 |
| First-pass validity | 43/46 = 93.5% | 33/36 = 91.7% |
| Final validation success | 44/46 = 95.7% | 35/36 = 97.2% |
| Average iterations | 47/46 = 1.02 | 40/36 = 1.11 |
| Plan approval rate | 21/35 = 60.0% | 24/31 = 77.4% |
| Partly approved / rejected | 6 / 8 | 2 / 5 |
| Undecided | 2 | 3 |
| Output tokens (planning + chat) | 87,146 (50,577 + 36,569) | 49,546 (26,957 + 22,589) |
| Input tokens | 5.05M | 4.87M |
| Requests | 258 | 351 |

Claude's two failed calls have no token count: their runs ended with the error.

The first attempts that failed:

| | claude-sonnet-5-5 | gpt-6.1-sol |
|---|---|---|
| Brought an error, fixed at the next attempt | plan 1 (session 3): an assess action in the lifecycle of the Case, not of the Application | — |
| Stopped at a syntax mistake, fixed at the next attempt | — | plans 2 and 3: a name with spaces (an input, an action) |
| No plan at all | plans 9 and 22 (session 3): `simulate_plan` called with no arguments, which ended the turn | plan 17: only an empty plan, then it stopped |

- **Claude's empty calls.** The endpoint holds GPT to a tool's schema (`strict`) but not Claude. A call with no
  arguments at all is what the endpoint gives when Claude's reply is stopped before it finishes; what stopped these two
  is not in the log.
- **GPT's empty plans.** GPT simulated an empty plan first in 22 of its 36 plans. Its first move was forced to be a
  simulation, before it had read anything. The planning agent now chooses its moves itself, and the empty plans are
  not counted above.

## What they produced

Both documents pass the editor's check with no errors and no warnings.

| | claude-sonnet-5-5 | gpt-6.1-sol |
|---|---|---|
| Lines | 261 | 462 |
| Entity | `Application` | `Care allowance application` |
| Roles | 4 | 4 |
| Actions | 22 | 23 |
| Data properties | 12 | 14 |
| Inputs / outputs | 9 / 3 | 11 / 3 |
| States (each with a state specification) | 5 | 4 |
| Enabled specifications | 21 | 17 |
| When rules | 19 | 15 |
| Scenarios | 20 | 30 |
| DCR Solutions events | 67 | 76 |
| Conditions / responses / includes / excludes / milestones | 32 / 0 / 25 / 18 / 14 | 26 / 21 / 25 / 24 / 12 |

The runs do not compare exactly: Claude's continued in a second session from the first's document, and the user's
requests were not the same in both.
