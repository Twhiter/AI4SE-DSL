// The metrics on small sessions whose numbers are worked out by hand (see each comment).

import { describe, expect, it } from 'vitest';
import {
    averageIterations, finalValidationSuccess, firstPassValidity, isValid, metrics, planApprovalRate,
    type AttemptOutcome, type PlanOutcome
} from './metrics.ts';

const valid: AttemptOutcome = { ran: true, newErrors: [] };
const stopped: AttemptOutcome = { ran: false, newErrors: [] };            // a wrong tool call or a syntax mistake
const withErrors: AttemptOutcome = { ran: true, newErrors: ['an error'] };  // ran, but brought an error

describe('isValid', () => {
    it('needs the steps to run and no new error', () => {
        expect(isValid(valid)).toBe(true);
        expect(isValid(stopped)).toBe(false);
        expect(isValid(withErrors)).toBe(false);
    });
});

describe('a session of four plans', () => {
    // plan 1: valid at once, approved                      first: valid    last: valid    attempts: 1
    // plan 2: stopped, then valid, rejected                first: -        last: valid    attempts: 2
    // plan 3: stopped, with errors, valid, undecided       first: -        last: valid    attempts: 3
    // plan 4: stopped twice, no plan                       first: -        last: -        attempts: 2
    const plans: PlanOutcome[] = [
        { attempts: [valid], decision: 'approved' },
        { attempts: [stopped, valid], decision: 'rejected' },
        { attempts: [stopped, withErrors, valid], decision: 'undecided' },
        { attempts: [stopped, stopped] }
    ];

    it('first-pass validity: 1 of 4', () => {
        expect(firstPassValidity(plans)).toEqual({ count: 1, of: 4, value: 0.25 });
    });

    it('final validation success: 3 of 4', () => {
        expect(finalValidationSuccess(plans)).toEqual({ count: 3, of: 4, value: 0.75 });
    });

    it('average iterations: 8 attempts over 4 plans', () => {
        expect(averageIterations(plans)).toEqual({ sum: 8, of: 4, value: 2 });
    });

    it('plan approval rate: 1 approved of 2 decided; the undecided plan and the plan never offered do not count', () => {
        expect(planApprovalRate(plans)).toEqual({ count: 1, of: 2, value: 0.5 });
        expect(metrics(plans).undecided).toBe(1);
    });
});

describe('edge cases', () => {
    it('a plan that ran but brought errors is not finally valid', () => {
        expect(finalValidationSuccess([{ attempts: [stopped, withErrors] }])).toEqual({ count: 0, of: 1, value: 0 });
    });

    it('a plan without attempts counts as not valid, with 0 iterations', () => {
        const plans: PlanOutcome[] = [{ attempts: [] }, { attempts: [valid] }];
        expect(firstPassValidity(plans)).toEqual({ count: 1, of: 2, value: 0.5 });
        expect(averageIterations(plans)).toEqual({ sum: 1, of: 2, value: 0.5 });
    });

    it('no plans: no values', () => {
        expect(metrics([])).toEqual({
            plans: 0,
            firstPassValidity: { count: 0, of: 0, value: undefined },
            finalValidationSuccess: { count: 0, of: 0, value: undefined },
            averageIterations: { sum: 0, of: 0, value: undefined },
            planApprovalRate: { count: 0, of: 0, value: undefined },
            undecided: 0
        });
    });
});
