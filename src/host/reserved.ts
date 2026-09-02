/**
 * `run_code` is the Code Mode transport the harness itself depends on. It must
 * stay reachable in every session, so it can never be switched off: the
 * settings route rejects the attempt with 409, the panels render its switch
 * disabled, and enforcement ignores a stored entry naming it. One constant
 * keeps the four of those from drifting apart.
 */
export const RESERVED_TOOL = 'run_code';
