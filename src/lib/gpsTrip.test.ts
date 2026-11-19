import { describe, expect, it } from "vitest";
import { addPoint, distanceM, kmOf, type TripState } from "./gpsTrip";

const start: TripState = { vehicleId: "v", startedAt: 0, meters: 0, last: null, points: 0 };
// ~0.009° latitudine ≈ 1 km
const at = (i: number, t: number, acc = 10) => ({ lat: 44.4 + i * 0.009, lon: 26.1, t: t * 1000, acc });

describe("traseu GPS", () => {
  it("distanța între două puncte", () => {
    expect(Math.round(distanceM({ lat: 44.4, lon: 26.1 }, { lat: 44.409, lon: 26.1 }))).toBe(1001);
  });
  it("adună km pe drum (1 km pe minut)", () => {
    let s = start;
    for (let i = 0; i <= 10; i++) s = addPoint(s, at(i, i * 60));
    expect(kmOf(s)).toBe(10);
  });
  it("ignoră punctele imprecise și săriturile imposibile", () => {
    let s = addPoint(start, at(0, 0));
    s = addPoint(s, at(5, 1, 10)); // 5 km într-o secundă
    s = addPoint(s, at(1, 60, 300)); // precizie 300 m
    expect(s.meters).toBe(0);
    s = addPoint(s, at(1, 60));
    expect(kmOf(s)).toBe(1);
  });
  it("nu adună tremurul GPS-ului cât stă pe loc", () => {
    let s = addPoint(start, { lat: 44.4, lon: 26.1, t: 0, acc: 20 });
    for (let i = 1; i < 50; i++) s = addPoint(s, { lat: 44.4 + (i % 2) * 0.0001, lon: 26.1, t: i * 5000, acc: 20 });
    expect(s.meters).toBe(0);
  });
});
