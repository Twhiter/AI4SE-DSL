// The experiment's metrics over a session's plans, as the session log reports them (session-log.ts). Each is a pure
// function of the recorded data, with no state and no I/O, and gives its count with its value, so that a number can be
// checked by hand against the log. The unit is a plan: one call of plan_changes, with the planning agent's attempts
// (its simulations, in order) and, when it gave a plan, the user's decision on it.
//
//   valid attempt              its steps all ran, and the check of the document after it found no new error
//                              (validation or Z3); errors the document already had do not count
//   first-pass validity        plans whose first attempt is valid / plans
//   final validation success   plans whose last attempt is valid / plans
//   average iterations         attempts / plans
//   plan approval rate         approved plans / plans the user decided on (approved or rejected); a plan left
//                              undecided (the user wrote a message instead) is not counted
//
// A plan without any attempt counts as neither first-pass valid nor finally valid, with 0 iterations.

/** What the metrics need of an attempt: whether its steps ran, and the errors it brought. */
export interface AttemptOutcome {
    ran: boolean;
    newErrors: unknown[];
}

/** What the metrics need of a plan: its attempts in order, and the user's decision, if it was offered and decided. */
export interface PlanOutcome {
    attempts: AttemptOutcome[];
    decision?: 'approved' | 'rejected' | 'undecided';
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
}

/** Whether an attempt is valid: its steps all ran, and it brought no new error. */
export function isValid(attempt: AttemptOutcome): boolean {
    return attempt.ran && attempt.newErrors.length === 0;
}

/** Plans whose first attempt is valid / plans. */
export function firstPassValidity(plans: PlanOutcome[]): Rate {
    return rate(plans.filter(({ attempts }) => attempts.length > 0 && isValid(attempts[0])).length, plans.length);
}

/** Plans whose last attempt is valid / plans. */
export function finalValidationSuccess(plans: PlanOutcome[]): Rate {
    return rate(plans.filter(({ attempts }) => attempts.length > 0 && isValid(attempts[attempts.length - 1])).length, plans.length);
}

/** Attempts / plans. */
export function averageIterations(plans: PlanOutcome[]): Average {
    const sum = plans.reduce((total, { attempts }) => total + attempts.length, 0);
    return { sum, of: plans.length, value: plans.length > 0 ? sum / plans.length : undefined };
}

/** Approved plans / plans the user decided on (approved or rejected). */
export function planApprovalRate(plans: PlanOutcome[]): Rate {
    const approved = plans.filter(({ decision }) => decision === 'approved').length;
    const rejected = plans.filter(({ decision }) => decision === 'rejected').length;
    return rate(approved, approved + rejected);
}

/** All the metrics of a session's plans. */
export function metrics(plans: PlanOutcome[]): Metrics {
    return {
        plans: plans.length,
        firstPassValidity: firstPassValidity(plans),
        finalValidationSuccess: finalValidationSuccess(plans),
        averageIterations: averageIterations(plans),
        planApprovalRate: planApprovalRate(plans),
        undecided: plans.filter(({ decision }) => decision === 'undecided').length
    };
}

function rate(count: number, of: number): Rate {
    return { count, of, value: of > 0 ? count / of : undefined };
}
