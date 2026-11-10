import { recurrenceDays, monthMatrix, startOfWeek, isoWeekNo, dateStr } from "../public/js/util.js";
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " got=" + JSON.stringify(got) + " want=" + JSON.stringify(want)));
};
eq("daily", recurrenceDays("2026-01-30", "daily", "2026-02-01", "2026-02-03"), ["2026-02-01", "2026-02-02", "2026-02-03"]);
eq("weekly", recurrenceDays("2026-01-05", "weekly", "2026-01-10", "2026-02-02"), ["2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02"]);
eq("monthly-31", recurrenceDays("2026-01-31", "monthly", "2026-01-01", "2026-05-31"), ["2026-01-31", "2026-03-31", "2026-05-31"]);
eq("yearly-leap", recurrenceDays("2024-02-29", "yearly", "2024-01-01", "2028-12-31"), ["2024-02-29", "2028-02-29"]);
eq("skip", recurrenceDays("2026-01-01", "daily", "2026-01-01", "2026-01-03", 400, ["2026-01-02"]), ["2026-01-01", "2026-01-03"]);
eq("until", recurrenceDays("2026-01-01", "daily", "2026-01-01", "2026-01-10", 400, [], "2026-01-03"), ["2026-01-01", "2026-01-02", "2026-01-03"]);
eq("week-start", startOfWeek("2026-11-07"), "2026-11-02");
eq("month-cells", monthMatrix(2026, 11).length, 42);
console.log("ISO week", isoWeekNo("2026-11-07"));
