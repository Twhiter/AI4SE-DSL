// The agents' instructions: prompt files (packages/chatbot/prompt) with their placeholders filled in. They are read at
// every turn, so that an edit applies at once. The skills are not here: the agents have them in their sandbox (sandbox.ts).
// The placeholders of both agents' instructions (system_prompt.md, planning_agent.md):
//   {context}               the domain the user described before entering the editor and the chat
//   {background_knowledge}  the text of prompt/background_knowledge.md
// and of the planning agent's only, the first of them required (the conversation is in its memory, agent.ts):
//   {change_tools}          the change tools a plan can use, as the document is now, with their arguments
//   {read_tools}            the tools it can call at any time, which change nothing
// Only {lowercase_words} are placeholders, so the braces of DSL text or JSON in a prompt stay as they are. A
// placeholder without a value, or a required one missing, is a mistake in the prompt: it stops the turn, with an
// error that says so.
// With SKILLS=off (the experiment's ablation, experiment/no-skills.ts) each file loses what it says about skills.

import { readFileSync } from 'node:fs';
import { forTheAgents } from './experiment/no-skills.ts';

/** The chat agent's instructions: prompt/system_prompt.md. */
export function chatInstructions(domain: string): string {
    return prompt('system_prompt', both(domain));
}

/** What the planning agent works with, besides the domain: the tools, each as text. */
export interface PlanningContext {
    changeTools: string;
    readTools: string;
}

/** The planning agent's instructions: prompt/planning_agent.md. */
export function planningInstructions(domain: string, { changeTools, readTools }: PlanningContext): string {
    const values = { ...both(domain), change_tools: changeTools, read_tools: readTools };
    return prompt('planning_agent', values, ['change_tools']);
}

/** The placeholders of both agents' instructions. */
function both(domain: string): Record<string, string> {
    return {
        context: domain,
        background_knowledge: prompt('background_knowledge')
    };
}

/** prompt/<name>.md, each {key} in it replaced by values[key]; the `required` placeholders must be in it. */
function prompt(name: string, values: Record<string, string> = {}, required: string[] = []): string {
    const text = forTheAgents(readFileSync(new URL(`../prompt/${name}.md`, import.meta.url), 'utf8'));
    const missing = required.filter(key => !text.includes(`{${key}}`));
    if (missing.length > 0) {
        throw new Error(`prompt/${name}.md must contain ${missing.map(key => `{${key}}`).join(' and ')}, or the agent does not get what it holds.`);
    }
    return text.replace(/\{([a-z_]+)\}/g, (placeholder, key: string) => {
        if (!Object.keys(values).includes(key)) {
            const known = Object.keys(values).map(known => `{${known}}`).join(', ') || 'none';
            throw new Error(`prompt/${name}.md has the placeholder ${placeholder}, which has no value; its placeholders are: ${known}.`);
        }
        return values[key];
    });
}
