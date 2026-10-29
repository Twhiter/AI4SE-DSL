// The ablation without skills, for the experiment: with SKILLS=off in packages/chatbot/.env, the agents run without
// their skills, and everything else stays as it is (the tools, the feedback of simulate_plan, the models and their
// reasoning). The agents then have no skills capability (sandbox.ts), and their instructions lose what they say about
// skills: withoutSkills cuts it from each prompt file's text before its placeholders are filled (prompts.ts), so that
// the files stay as they are, and the domain text and the tool lists are never cut.

/** Whether the agents have their skills: yes, unless SKILLS=off (read at each use, after agent.ts loads .env). */
export function skillsOn(): boolean {
    return process.env.SKILLS?.trim().toLowerCase() !== 'off';
}

/** `text` as the agents get it: as it is, or without what it says about skills when the skills are off. */
export function forTheAgents(text: string): string {
    return skillsOn() ? text : withoutSkills(text);
}

/**
 * `text` without what it says about skills: its "# Skills" section (from that heading to the next heading of the same
 * level or higher), and every sentence with the word "skill" in it. A line keeps its other sentences, and its bullet;
 * a line left with none is dropped.
 */
export function withoutSkills(text: string): string {
    return withoutSentences(withoutSection(text.split('\n'), 'Skills')).join('\n');
}

/** `lines` without the section under the heading `title` (any level), up to the next heading of that level or higher. */
function withoutSection(lines: string[], title: string): string[] {
    const kept: string[] = [];
    let cutting: number | undefined;   // the level of the heading being cut
    for (const line of lines) {
        const heading = /^(#+)\s+(.*?)\s*$/.exec(line);
        if (heading && cutting !== undefined && heading[1].length <= cutting) {
            cutting = undefined;
        }
        if (heading && heading[2] === title) {
            cutting = heading[1].length;
        }
        if (cutting === undefined) {
            kept.push(line);
        }
    }
    return kept;
}

/** `lines`, each without its sentences that mention a skill; a line left with no sentence is dropped. */
function withoutSentences(lines: string[]): string[] {
    return lines.flatMap(line => {
        if (!SKILL.test(line)) {
            return [line];
        }
        const [, lead, rest] = /^(\s*(?:[-*]\s+|\d+\.\s+)?)(.*)$/.exec(line)!;   // the indentation and bullet, then the text
        const sentences = rest.split(/(?<=[.!?])\s+/).filter(sentence => !SKILL.test(sentence));
        return sentences.length > 0 ? [lead + sentences.join(' ')] : [];
    });
}

const SKILL = /skill/i;
