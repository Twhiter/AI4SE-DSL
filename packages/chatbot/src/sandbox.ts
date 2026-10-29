// The agents' sandbox: a Docker container for each conversation, in which the chat agent and the planning agent read
// the skills. The skills are standard Agent Skills folders (packages/chatbot/skills/<name>/SKILL.md, with any
// references/, scripts/ or assets/ beside it). The agents' instructions list them, by name and description, as the
// folder is at each turn; an agent loads a skill with load_skill, which copies its folder into the container (once per
// conversation, so an edit to a loaded skill applies from the next conversation on), and reads it with exec_command.
// The container has no network and sees only what is copied into it, not the files of this machine. Docker must run.
// With SKILLS=off (the experiment's ablation, experiment/no-skills.ts) the agents have neither the skills nor the shell.

import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shell, skills, type Capability, type SandboxRunConfig, type SandboxSessionLike } from '@openai/agents/sandbox';
import { DockerSandboxClient, localDirLazySkillSource } from '@openai/agents/sandbox/local';
import { skillsOn } from './experiment/no-skills.ts';

const CHATBOT = fileURLToPath(new URL('..', import.meta.url));
const SKILLS = fileURLToPath(new URL('../skills', import.meta.url));

const client = new DockerSandboxClient({ networkMode: 'none' });

/** The sandboxes that are open, to close when the server stops. */
const open = new Set<SandboxSessionLike>();

/** What a sandbox agent has: a shell (exec_command), and the skills, listed in its instructions and loaded with load_skill. */
export function sandboxCapabilities(): Capability[] {
    if (!skillsOn()) {
        return [];
    }
    return [shell(), skills({ lazyFrom: localDirLazySkillSource({ src: 'skills', baseDir: CHATBOT }) })];
}

/** A new sandbox, for one conversation: a container, empty until an agent loads a skill. */
export async function openSandbox(): Promise<SandboxSessionLike> {
    // the SDK copies a skill into the sandbox only from inside the working directory (npm run documents runs here)
    if (relative(process.cwd(), SKILLS).startsWith('..')) {
        throw new Error(`The chatbot must run from a folder that holds its skills (${SKILLS}), not from ${process.cwd()}.`);
    }
    let sandbox: SandboxSessionLike;
    try {
        sandbox = await client.create();
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`The agents' sandbox needs Docker, which could not start a container (is Docker running?): ${reason}`);
    }
    open.add(sandbox);
    return sandbox;
}

/**
 * How a run uses a conversation's sandbox. What the agents add to it (the skills) is worked out from an empty manifest,
 * not from the sandbox's: a skill loaded in an earlier turn is in the sandbox's manifest, and the SDK's skills refuse a
 * manifest that already has one.
 */
export function inSandbox(sandbox: SandboxSessionLike): SandboxRunConfig {
    return { session: sandbox, manifest: {} };
}

/** Closes a sandbox: its container is removed. */
export async function closeSandbox(sandbox: SandboxSessionLike): Promise<void> {
    open.delete(sandbox);
    await sandbox.close?.();
}

// the server stops (Ctrl+C): the open sandboxes are closed first, so that no container is left running
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
        void Promise.allSettled([...open].map(closeSandbox)).then(() => process.kill(process.pid, signal));
    });
}
