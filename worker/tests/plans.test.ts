import { describe, expect, it } from "vitest";
import {
  PLANS,
  PLAN_ORDER,
  checkRegistrationQuota,
  cheapestPlanWithApiAccess,
  smallestPlanFor,
} from "../src/domain/plans.js";

describe("plan catalogue", () => {
  it("matches the prices advertised on the landing screen", () => {
    expect(PLANS.free.priceUsdMonthly).toBe(0);
    expect(PLANS.creator.priceUsdMonthly).toBe(10);
    expect(PLANS.professional.priceUsdMonthly).toBe(25);
    expect(PLANS.studio.priceUsdMonthly).toBe(100);
  });

  it("matches the advertised registration allowances", () => {
    expect(PLANS.free.monthlyRegistrations).toBe(5);
    expect(PLANS.creator.monthlyRegistrations).toBe(50);
    expect(PLANS.professional.monthlyRegistrations).toBeNull();
    expect(PLANS.studio.monthlyRegistrations).toBeNull();
  });

  it("gates API access to Professional and above, as advertised", () => {
    expect(PLANS.free.apiAccess).toBe(false);
    expect(PLANS.creator.apiAccess).toBe(false);
    expect(PLANS.professional.apiAccess).toBe(true);
    expect(PLANS.studio.apiAccess).toBe(true);
  });

  it("orders plans by ascending price", () => {
    const prices = PLAN_ORDER.map((id) => PLANS[id].priceUsdMonthly);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  it("keys every plan by its own id", () => {
    for (const [key, plan] of Object.entries(PLANS)) {
      expect(plan.id).toBe(key);
    }
  });
});

describe("checkRegistrationQuota", () => {
  it("allows a fresh free account and reports the full allowance", () => {
    expect(checkRegistrationQuota("free", 0)).toEqual({ allowed: true, remaining: 5 });
  });

  it("counts down as registrations are used", () => {
    expect(checkRegistrationQuota("free", 4)).toEqual({ allowed: true, remaining: 1 });
  });

  it("blocks the registration that would exceed the cap", () => {
    const decision = checkRegistrationQuota("free", 5);
    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
    expect(decision.reason).toMatch(/5 registrations per month/);
  });

  it("fails closed when usage already exceeds the cap, e.g. after a downgrade", () => {
    const decision = checkRegistrationQuota("free", 40);
    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
  });

  it("never blocks an unlimited plan and reports no finite remainder", () => {
    expect(checkRegistrationQuota("professional", 10_000)).toEqual({
      allowed: true,
      remaining: null,
    });
    expect(checkRegistrationQuota("studio", 10_000).allowed).toBe(true);
  });

  it.each([
    ["a negative count", -1],
    ["a fractional count", 1.5],
    ["NaN", Number.NaN],
  ])("rejects %s rather than guessing", (_label, used) => {
    const decision = checkRegistrationQuota("creator", used);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/non-negative integer/);
  });

  it("rejects an unknown plan id", () => {
    // @ts-expect-error deliberately outside the PlanId union
    const decision = checkRegistrationQuota("enterprise", 0);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/unknown plan/);
  });
});

describe("upgrade guidance", () => {
  it("points an API-hungry account at Professional, not Studio", () => {
    expect(cheapestPlanWithApiAccess().id).toBe("professional");
  });

  it.each([
    [1, "free"],
    [5, "free"],
    [6, "creator"],
    [50, "creator"],
    [51, "professional"],
    [5_000, "professional"],
  ])("recommends %i registrations/month → %s", (volume, expected) => {
    expect(smallestPlanFor(volume)?.id).toBe(expected);
  });
});
