/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://vitest.dev/config/
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        deps: {
            interopDefault: true
        },
        include: ['**/*.test.ts'],
        // disconnected until the semantics follows the new model: this test checks the old Z3 model
        exclude: ['**/node_modules/**', 'test/model-z3.test.ts']
    }
});
