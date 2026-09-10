/**
 * Subscription tiers, transcribed from the pricing block on the landing screen.
 *
 * `monthlyRegistrations: null` means unlimited. Keep this file the single source of
 * truth — the marketing copy and the quota gate must never drift apart.
 */

export type PlanId = "free" | "creator" | "professional" | "studio";

export interface Plan {
  id: PlanId;
  name: string;
  priceUsdMonthly: number;
  /** null = unlimited */
  monthlyRegistrations: number | null;
  apiAccess: boolean;
  teamSeats: number;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceUsdMonthly: 0,
    monthlyRegistrations: 5,
    apiAccess: false,
    teamSeats: 1,
  },
  creator: {
    id: "creator",
    name: "Creator",
    priceUsdMonthly: 10,
    monthlyRegistrations: 50,
    apiAccess: false,
    teamSeats: 1,
  },
  professional: {
    id: "professional",
    name: "Professional",
    priceUsdMonthly: 25,
    monthlyRegistrations: null,
    apiAccess: true,
    teamSeats: 1,
  },
  studio: {
    id: "studio",
    name: "Studio",
    priceUsdMonthly: 100,
    monthlyRegistrations: null,
    apiAccess: true,
    teamSeats: 10,
  },
};

export const PLAN_ORDER: readonly PlanId[] = ["free", "creator", "professional", "studio"];

export interface QuotaDecision {
  allowed: boolean;
  /** null when the plan is unlimited */
  remaining: number | null;
  reason?: string;
}

/**
 * Whether an account on `planId` may record one more registration this billing month.
 *
 * `usedThisMonth` is the count already recorded in the current period. A count above
 * the cap is treated as over quota rather than as a negative allowance, so a plan
 * downgrade mid-month fails closed instead of handing out credit.
 */
export function checkRegistrationQuota(planId: PlanId, usedThisMonth: number): QuotaDecision {
  const plan = PLANS[planId];
  if (!plan) {
    return { allowed: false, remaining: 0, reason: `unknown plan: ${planId}` };
  }
  if (!Number.isInteger(usedThisMonth) || usedThisMonth < 0) {
    return { allowed: false, remaining: 0, reason: "usedThisMonth must be a non-negative integer" };
  }
  if (plan.monthlyRegistrations === null) {
    return { allowed: true, remaining: null };
  }

  const remaining = Math.max(0, plan.monthlyRegistrations - usedThisMonth);
  if (remaining === 0) {
    return {
      allowed: false,
      remaining: 0,
      reason: `${plan.name} allows ${plan.monthlyRegistrations} registrations per month`,
    };
  }
  return { allowed: true, remaining };
}

/** The cheapest plan that grants API access — what the upgrade prompt should point at. */
export function cheapestPlanWithApiAccess(): Plan {
  const candidates = PLAN_ORDER.map((id) => PLANS[id]).filter((plan) => plan.apiAccess);
  return candidates.reduce((cheapest, plan) =>
    plan.priceUsdMonthly < cheapest.priceUsdMonthly ? plan : cheapest,
  );
}

/** The cheapest plan that would clear a given monthly registration volume. */
export function smallestPlanFor(monthlyVolume: number): Plan | null {
  for (const id of PLAN_ORDER) {
    const plan = PLANS[id];
    if (plan.monthlyRegistrations === null || plan.monthlyRegistrations >= monthlyVolume) {
      return plan;
    }
  }
  return null;
}
