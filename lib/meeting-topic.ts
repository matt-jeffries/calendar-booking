export const meetingTopics = ["A role", "A project", "Just saying hello"] as const;

const prefix = "About: ";

/** Stores the chosen topic as the first line of the booking context, so no database change is needed. */
export function contextWithTopic(topic: unknown, notes: string) {
  const chosen = meetingTopics.find((item) => item === topic);
  if (!chosen) return notes;
  return notes ? `${prefix}${chosen}\n\n${notes}` : `${prefix}${chosen}`;
}

export function meetingTitle(booking: { name: string; context: string }) {
  const firstLine = booking.context?.split("\n", 1)[0] ?? "";
  const topic = meetingTopics.find((item) => firstLine === `${prefix}${item}`);
  return topic ? `${topic} · Meeting with ${booking.name}` : `Meeting with ${booking.name}`;
}
