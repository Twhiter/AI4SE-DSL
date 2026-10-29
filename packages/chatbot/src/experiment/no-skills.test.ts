// withoutSkills on small texts, and on the prompt files as they are.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withoutSkills } from './no-skills.ts';

describe('withoutSkills', () => {
    it('cuts the Skills section up to the next heading of its level', () => {
        expect(withoutSkills('# A\na\n# Skills\nabout skills\n## Inside\nstill cut\n# B\nb')).toBe('# A\na\n# B\nb');
    });

    it('cuts the sentences about skills, and keeps a line\'s other sentences and its bullet', () => {
        expect(withoutSkills('- Read the skill first. Use the grammar tools.')).toBe('- Use the grammar tools.');
        expect(withoutSkills('* Load the skill.\nKeep this.')).toBe('Keep this.');
    });

    it('leaves a text without skills as it is', () => {
        const text = '# Task\n\n1. Plan the change.\n{context}';
        expect(withoutSkills(text)).toBe(text);
    });

    it('leaves nothing about skills in the prompt files, and keeps their placeholders', () => {
        for (const name of ['system_prompt', 'planning_agent', 'background_knowledge']) {
            const text = readFileSync(new URL(`../../prompt/${name}.md`, import.meta.url), 'utf8');
            const cut = withoutSkills(text);
            expect(cut).not.toMatch(/skill/i);
            expect(cut.match(/\{[a-z_]+\}/g)).toEqual(text.match(/\{[a-z_]+\}/g));
        }
    });
});
