// The choices a reply leaves the user that are not changes (next steps to pick from, a question with answers to pick
// from), which the chat agent offers with offer_choices, and the chat pane shows as buttons under the reply; a click
// sends the option's message, as if the user had typed it. Changes it offers otherwise: with propose_changes, as options
// whose plans are checked first (agent.ts). With OPTIONS=off in packages/chatbot/.env, for the experiment, the chat
// agent does not get offer_choices; the options of propose_changes stay, as they are how the user picks a change.

import { tool, type FunctionTool } from '@openai/agents';
import { z } from 'zod';

/** A choice the user can click: its button, and the message it sends. */
export interface Option {
    label: string;
    message: string;
    /** The one the reply recommends, if it recommends one; it comes first. */
    recommended: boolean;
}

/** How many choices the buttons show. */
const MOST = 4;

/** Whether the chat agent offers choices as buttons: yes, unless OPTIONS=off (read at each use, after agent.ts loads .env). */
export function optionsOn(): boolean {
    return process.env.OPTIONS?.trim().toLowerCase() !== 'off';
}

/** offer_choices, which gives `offer` the choices, the recommended one first, for the buttons under the reply. */
export function offerChoicesTool(offer: (options: Option[]) => void): FunctionTool<any, any, any> {
    const parameters = z.object({
        choices: z.array(z.object({
            label: z.string().describe('The button: two to five words, such as "Extract actions" or "Core states only".'),
            message: z.string().describe('What clicking it sends, in the user\'s voice, as they would type it, naming what to do so that it reads on its own: "Extract the actions next."'),
            recommended: z.boolean().describe('Whether your reply recommends this choice.')
        }))
    });
    return tool({
        name: 'offer_choices',
        description: `Show the choices your reply leaves the user as buttons under it, so that they can answer with a click: next steps to pick from (one per step), or a question with answers to pick from (one per answer). At most ${MOST}; take them from your reply's own words. Not for changes to the document: offer those with propose_changes. Call it at most once a turn; the buttons follow your reply.`,
        parameters,
        strict: true,
        execute: ({ choices }: z.infer<typeof parameters>) => {
            offer([...choices.filter(({ recommended }) => recommended), ...choices.filter(({ recommended }) => !recommended)].slice(0, MOST));
            return 'The buttons follow your reply.';
        },
        errorFunction: null
    });
}
