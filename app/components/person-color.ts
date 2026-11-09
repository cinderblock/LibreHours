/**
 * A Mantine colour per person, so someone is the same colour on the admin
 * calendar and beside an admin's own day.
 */
const PALETTE = ["blue", "orange", "grape", "teal", "pink", "lime", "indigo", "red", "cyan", "yellow", "violet", "green"];

export const personColor = (userId: number): string => PALETTE[userId % PALETTE.length]!;
