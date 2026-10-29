// The experiment's events: what happens in a session, announced by the workflow for the session log (session-log.ts)
// to record. The workflow only announces; it records and writes nothing. Two kinds of announcements:
//   - the agents' runs, through `runner`, which agent.ts runs them with: each tool call (its start and end, with its
//     arguments) and each run's end, with the agent's model, reasoning effort and token usage;
//   - each simulation of a plan, which agent.ts announces itself (simulated).
// An event belongs to the session it happens in: chat-session.ts runs each turn inSession(<its session>), and the
// events of the turn carry that session, whichever agent or tool they come from.

import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { Runner, type Agent } from '@openai/agents';
import type { PlanStep, Simulation } from 'dsl-controller';

/** What the experiment records. */
export type ExperimentEvent =
    | { kind: 'tool_start', agent: string, tool: string, arguments: string }
    | { kind: 'tool_end', agent: string, tool: string, arguments: string }
    | { kind: 'run_end', agent: string, model: string, effort: string | undefined, tokens: Tokens }
    | { kind: 'simulation', steps: PlanStep[], simulation: Simulation };

/** A run's token usage, as the API reports it. */
export interface Tokens {
    requests: number;
    input: number;
    output: number;
    total: number;
}

/** An event, with the session it belongs to. */
export type SessionEvent = ExperimentEvent & { session: string };

const events = new EventEmitter();
const current = new AsyncLocalStorage<string>();

/** Runs `turn` as part of `session`: the events it causes belong to that session. */
export function inSession<T>(session: string, turn: () => Promise<T>): Promise<T> {
    return current.run(session, turn);
}

/** Calls `listener` with each event of `session`; the returned function stops it. */
export function listen(session: string, listener: (event: SessionEvent) => void): () => void {
    const ofSession = (event: SessionEvent) => {
        if (event.session === session) {
            listener(event);
        }
    };
    events.on('event', ofSession);
    return () => events.off('event', ofSession);
}

/** Announces `event`, as part of the session under way; outside a session it is not recorded. */
function announce(event: ExperimentEvent): void {
    const session = current.getStore();
    if (session !== undefined) {
        events.emit('event', { ...event, session } satisfies SessionEvent);
    }
}

/** Announces a simulation of a plan: its steps, and what the simulation found. */
export function simulated(steps: PlanStep[], simulation: Simulation): void {
    announce({ kind: 'simulation', steps, simulation });
}

/**
 * The runner the agents run with, as the SDK's run() would, which also announces their tool calls and the ends of their
 * runs. (Hooks on the agents themselves would be lost: the SDK runs a copy of a sandbox agent.)
 */
export const runner = new Runner();

runner.on('agent_tool_start', (_context, agent, tool, { toolCall }) => {
    announce({ kind: 'tool_start', agent: agent.name, tool: tool.name, arguments: argumentsOf(toolCall) });
});
runner.on('agent_tool_end', (_context, agent, tool, _result, { toolCall }) => {
    announce({ kind: 'tool_end', agent: agent.name, tool: tool.name, arguments: argumentsOf(toolCall) });
});
runner.on('agent_end', ({ usage }, agent: Agent<any, any>) => {
    announce({
        kind: 'run_end',
        agent: agent.name,
        model: typeof agent.model === 'string' ? agent.model : 'a model object',
        effort: agent.modelSettings.reasoning?.effort ?? undefined,
        tokens: { requests: usage.requests, input: usage.inputTokens, output: usage.outputTokens, total: usage.totalTokens }
    });
});

/** A tool call's arguments as the model wrote them (a function call's JSON), or nothing for other kinds of call. */
function argumentsOf(toolCall: object): string {
    return 'arguments' in toolCall && typeof toolCall.arguments === 'string' ? toolCall.arguments : '';
}
