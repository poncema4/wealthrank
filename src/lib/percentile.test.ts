import { describe, it, expect } from "vitest";
import {
  BRACKETS,
  bracketForAge,
  percentileFor,
  netWorthAtPercentile,
  futureValue,
  projections,
  fmtMoney,
} from "./percentile";

// The math IS the product — if the percentile is wrong, every share card is a lie.

describe("bracketForAge", () => {
  it("routes ages to the right SCF bracket", () => {
    expect(bracketForAge(21).key).toBe("u35");
    expect(bracketForAge(34).key).toBe("u35");
    expect(bracketForAge(35).key).toBe("35_44");
    expect(bracketForAge(54).key).toBe("45_54");
    expect(bracketForAge(75).key).toBe("75p");
    expect(bracketForAge(99).key).toBe("75p");
  });

  it("clamps out-of-range ages instead of crashing", () => {
    expect(bracketForAge(5).key).toBe("u35");
    expect(bracketForAge(500).key).toBe("75p");
  });
});

describe("percentileFor — anchored to the published Fed numbers", () => {
  it("the bracket MEDIAN lands at the 50th percentile (every bracket)", () => {
    for (const b of BRACKETS) {
      const pct = percentileFor(b.minAge, b.median);
      expect(pct, `${b.label} median should be ~p50`).toBeGreaterThan(49);
      expect(pct, `${b.label} median should be ~p50`).toBeLessThan(51);
    }
  });

  it("the bracket MEAN lands well above the median (right-skew is modeled)", () => {
    for (const b of BRACKETS) {
      expect(percentileFor(b.minAge, b.mean)).toBeGreaterThan(65);
    }
  });

  it("is strictly monotonic in net worth", () => {
    let last = -1;
    for (const nw of [100, 1_000, 10_000, 39_000, 100_000, 500_000, 5_000_000]) {
      const pct = percentileFor(21, nw);
      expect(pct).toBeGreaterThan(last);
      last = pct;
    }
  });

  it("zero and negative net worth floor at p5, never crash", () => {
    expect(percentileFor(21, 0)).toBe(5);
    expect(percentileFor(21, -20_000)).toBe(5);
  });

  it("never claims 100th percentile", () => {
    expect(percentileFor(21, 1_000_000_000)).toBeLessThanOrEqual(99.5);
  });

  it("same net worth ranks HIGHER at a younger age (the whole point)", () => {
    const at21 = percentileFor(21, 50_000);
    const at50 = percentileFor(50, 50_000);
    expect(at21).toBeGreaterThan(at50);
  });
});

describe("netWorthAtPercentile — inverse round-trips", () => {
  it("round-trips percentile -> net worth -> percentile within 1 point", () => {
    for (const pct of [25, 50, 75, 90]) {
      const nw = netWorthAtPercentile(21, pct);
      expect(Math.abs(percentileFor(21, nw) - pct)).toBeLessThan(1);
    }
  });

  it("p50 equals the bracket median", () => {
    const nw = netWorthAtPercentile(21, 50);
    expect(nw).toBeGreaterThan(38_000);
    expect(nw).toBeLessThan(40_000);
  });
});

describe("futureValue", () => {
  it("no return = simple accumulation", () => {
    expect(futureValue(1000, 100, 0, 10)).toBe(1000 + 100 * 12 * 10);
  });

  it("compound growth beats simple accumulation", () => {
    expect(futureValue(10_000, 200, 0.07, 20)).toBeGreaterThan(10_000 + 200 * 12 * 20);
  });

  it("negative current net worth doesn't compound the debt in projections", () => {
    const fv = futureValue(-5_000, 100, 0.07, 10);
    expect(fv).toBeGreaterThan(0);
  });
});

describe("projections", () => {
  it("gives 5/10/20-year horizons with future-bracket percentiles", () => {
    const p = projections(21, 10_000, 300);
    expect(p.map((x) => x.years)).toEqual([5, 10, 20]);
    expect(p[2].ageThen).toBe(41); // 20yr projection crosses INTO the 35-44 bracket
    expect(p[0].value).toBeLessThan(p[2].value);
  });

  it("drops horizons that exceed max age", () => {
    const p = projections(95, 100_000, 0);
    expect(p.length).toBeLessThan(3);
  });
});

describe("fmtMoney", () => {
  it("formats the ranges humans actually see", () => {
    expect(fmtMoney(950)).toBe("$950");
    expect(fmtMoney(39_000)).toBe("$39K");
    expect(fmtMoney(1_500_000)).toBe("$1.5M");
    expect(fmtMoney(-2_000)).toBe("-$2.0K");
  });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { curveFor, monthlyForGoal } from "./percentile";

describe("curveFor", () => {
  it("samples a normalized single-peak curve", () => {
    const pts = curveFor(21);
    expect(pts.length).toBe(61);
    expect(Math.max(...pts.map((p) => p.density))).toBeCloseTo(1, 5);
    expect(pts[0].x).toBeLessThan(pts[60].x); // x strictly increasing
  });
});

describe("monthlyForGoal", () => {
  it("already-on-track returns $0/month", () => {
    const plan = monthlyForGoal(21, 5_000_000, 75, 30);
    expect(plan.monthlyNeeded).toBe(0);
  });

  it("round-trips: investing the answer reaches the target", () => {
    const plan = monthlyForGoal(21, 10_000, 75, 30);
    const fv = futureValue(10_000, plan.monthlyNeeded, 0.07, 9);
    expect(Math.abs(fv - plan.targetValue) / plan.targetValue).toBeLessThan(0.01);
  });

  it("higher targets need more per month", () => {
    const p50 = monthlyForGoal(21, 1_000, 50, 30).monthlyNeeded;
    const p90 = monthlyForGoal(21, 1_000, 90, 30).monthlyNeeded;
    expect(p90).toBeGreaterThan(p50);
  });
});
