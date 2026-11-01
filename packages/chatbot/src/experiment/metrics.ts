// The experiment's metrics over a session's plans, as the session log reports them (session-log.ts). Each is a pure
// function of the recorded data, with no state and no I/O, and gives its count with its value, so that a number can be
// checked by hand against the log. The unit is a plan: one planning run (a call of plan_changes, or an option of a
// call of propose_changes), with the planning agent's attempts (its simulations, in order) and, when it gave a plan, the
// user's decision on it.
//
//   valid attempt              its steps all ran, and the check of the document after it found no new error
//                              (validation or Z3); errors the document already had do not count
//   counted attempt            one with steps, or a call whose input was rejected (a failed attempt); a simulation
//                              of an empty plan is not an attempt at a plan
//   first-pass validity        plans whose first counted attempt is valid / plans
//   final validation success   plans whose last counted attempt is valid / plans
//   average iterations         counted attempts / plans
//   plan approval rate         approved plans / plans the user decided on (approved, partly approved or rejected); a
//                              plan left undecided (the user wrote a message instead), or an option not chosen, is
//                              not counted; a plan approved in part is decided on, not approved
//   partly approved            plans the user approved only some changes of
//
// A plan without any counted attempt counts as neither first-pass valid nor finally valid, with 0 iterations.

/** What the metrics need of an attempt: its steps, whether they ran (if not, why), and the errors it brought. */
export interface AttemptOutcome {
    steps: unknown[];
    ran: boolean;
    mistake?: string;
    newErrors: unknown[];
}

/** What the metrics need of a plan: its attempts in order, and the user's decision, if it was offered and decided. */
export interface PlanOutcome {
    attempts: AttemptOutcome[];
    decision?: 'approved' | 'partly approved' | 'rejected' | 'undecided' | 'not chosen';
}

/** A rate, with what it counts: `count` of `of`; `value` is undefined when `of` is 0. */
export interface Rate {
    count: number;
    of: number;
    value: number | undefined;
}

/** An average, with what it sums: `sum` over `of`; `value` is undefined when `of` is 0. */
export interface Average {
    sum: number;
    of: number;
    value: number | undefined;
}

/** The metrics of a session. */
export interface Metrics {
    plans: number;
    firstPassValidity: Rate;
    finalValidationSuccess: Rate;
    averageIterations: Average;
    planApprovalRate: Rate;
    /** Plans offered to the user and left undecided (not counted in the approval rate). */
    undecided: number;
    /** Plans the user approved only some changes of (decided on, not approved, in the approval rate). */
    partlyApproved: number;
}

/** Whether an attempt is valid: its steps all ran, and it brought no new error. */
export function isValid(attempt: AttemptOutcome): boolean {
    return attempt.ran && attempt.newErrors.length === 0;
}

/** A plan's counted attempts: those with steps, and the calls whose input was rejected. */
export function counted({ attempts }: PlanOutcome): AttemptOutcome[] {
    return attempts.filter(({ steps, mistake }) => steps.length > 0 || mistake === 'input');
}

/** Plans whose first counted attempt is valid / plans. */
export function firstPassValidity(plans: PlanOutcome[]): Rate {
    return rate(plans.filter(plan => { const first = counted(plan).at(0); return first !== undefined && isValid(first); }).length, plans.length);
}

/** Plans whose last counted attempt is valid / plans. */
export function finalValidationSuccess(plans: PlanOutcome[]): Rate {
    return rate(plans.filter(plan => { const last = counted(plan).at(-1); return last !== undefined && isValid(last); }).length, plans.length);
}

/** Counted attempts / plans. */
export function averageIterations(plans: PlanOutcome[]): Average {
    const sum = plans.reduce((total, plan) => total + counted(plan).length, 0);
    return { sum, of: plans.length, value: plans.length > 0 ? sum / plans.length : undefined };
}

/** Approved plans / plans the user decided on (approved, partly approved or rejected). */
export function planApprovalRate(plans: PlanOutcome[]): Rate {
    const approved = plans.filter(({ decision }) => decision === 'approved').length;
    const decided = plans.filter(({ decision }) => decision === 'approved' || decision === 'partly approved' || decision === 'rejected').length;
    return rate(approved, decided);
}

/** All the metrics of a session's plans. */
export function metrics(plans: PlanOutcome[]): Metrics {
    return {
        plans: plans.length,
        firstPassValidity: firstPassValidity(plans),
        finalValidationSuccess: finalValidationSuccess(plans),
        averageIterations: averageIterations(plans),
        planApprovalRate: planApprovalRate(plans),
        undecided: plans.filter(({ decision }) => decision === 'undecided').length,
        partlyApproved: plans.filter(({ decision }) => decision === 'partly approved').length
    };
}

function rate(count: number, of: number): Rate {
    return { count, of, value: of > 0 ? count / of : undefined };
}
