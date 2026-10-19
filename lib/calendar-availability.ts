import { appleBusyTimes } from "./apple-calendar";
import { microsoftBusyTimes } from "./microsoft-calendar";

export type CalendarBusyTime = {
  provider: "microsoft" | "apple";
  id: string;
  start: string;
  end: string;
};

export async function calendarBusyTimes(start: string, end: string, options: { freshApple?: boolean } = {}) {
  const [microsoft, apple] = await Promise.all([
    microsoftBusyTimes(start, end),
    appleBusyTimes(start, end, { fresh: options.freshApple }),
  ]);
  return [
    ...microsoft.map((item) => ({ ...item, provider: "microsoft" as const })),
    ...apple.map((item) => ({ ...item, provider: "apple" as const })),
  ];
}
