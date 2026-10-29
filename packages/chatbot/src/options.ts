// The options agent: after the chat agent's reply, it finds the choice the reply leaves the user, if any (an offer of
// what to do next, next steps to pick from, alternatives, a question), and gives it as options, which the chat pane
// shows as buttons; a click sends the option's message, as if the user had typed it. The chat agent knows nothing of
// it: its prompt and its replies are the same with options or without. With OPTIONS=off in packages/chatbot/.env, for
// the experiment, no reply has options.

import { Agent, run } from '@openai/agents';
import { z } from 'zod';
import { MODEL, NO_REASONING } from './agent.ts';

/** A choice the user can click: its button, and the message it sends. */
export interface Option {
    label: string;
    message: string;
    /** The one the reply recommends, if it recommends one; it comes first. */
    recommended: boolean;
}

const OPTIONS = z.object({
    options: z.array(z.object({
        label: z.string().describe('The button: two to five words, such as "Extract actions" or "Core states only".'),
        message: z.string().describe('What clicking it sends, in the user\'s voice, as they would type it: "Extract the actions next."'),
        recommended: z.boolean().describe('Whether the reply recommends this option.')
    })).describe('The choices the reply leaves the user, at most four, the recommended one first; none when it leaves none.')
});

const INSTRUCTIONS = `You read the last reply of an assistant that helps a user write a model in a modelling language, and find the choice it leaves the user, so that the user can answer with a click instead of typing.

A choice is what the reply asks the user to decide before the assistant goes on:
- an offer of what to do next ("If you want, I can extract the states next."): one option that accepts it;
- next steps to pick from ("Good next steps: 1. actions 2. data properties 3. states. I'd do actions first."): one option per step;
- alternatives ("Two ways: … or …", "a minimal set, or a fuller one?"): one option per alternative;
- a question with answers to pick from ("Only the core states first, or also the review states?"): one option per answer.

Not a choice: an ordering of steps the assistant would follow, the parts of one change it offers, an explanation, a list of elements it proposes or added, a summary of what was done, a plan waiting for approval. So "I'd do this in order: 1. actions 2. states 3. rules. If you want, I can extract the actions and states together." leaves one option, the offer; and so does "If you want, I can plan this: 1. … 2. … 3. …". A reply that leaves no choice has no options.

A reply that lists next steps to pick from and then offers, without naming one, to do "one of them" or "the next change" leaves one choice: give each step once, and not that offer as another option.

Each option sends a message in the user's voice, short, as the user would type it, naming what to do so that it reads on its own ("Extract the actions next.", "Add only the core lifecycle states."; not "Do point 4."). Mark an option recommended when the reply recommends it anywhere ("I'd do actions first.", "I'd start with the smaller set.", "Best next step: data properties.", "My recommendation: …"); when it recommends none of them, no option is. Give at most four options, the recommended one first. Take the options from the reply's own words; never invent one it does not offer.`;

const optionsAgent = new Agent({
    name: 'Options agent',
    instructions: INSTRUCTIONS,
    model: MODEL,
    modelSettings: { store: false, ...NO_REASONING },
    outputType: OPTIONS
});

/** Whether replies have options: yes, unless OPTIONS=off (read at each use, after agent.ts loads .env). */
export function optionsOn(): boolean {
    return process.env.OPTIONS?.trim().toLowerCase() !== 'off';
}

/** The options `reply` leaves the user, who wrote `message`; none when it leaves no choice. */
export async function findOptions(message: string, reply: string): Promise<Option[]> {
    const result = await run(optionsAgent, `The user wrote:\n${message}\n\nThe assistant replied:\n${reply}`);
    const options = result.finalOutput?.options ?? [];
    return [...options.filter(({ recommended }) => recommended), ...options.filter(({ recommended }) => !recommended)].slice(0, 4);
}
