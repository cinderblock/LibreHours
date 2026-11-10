/**
 * A Mantine colour per person, so someone is the same colour on the admin
 * calendar and beside an admin's own day.
 */
// Nothing that reads as a status: no orange, red or yellow ("needs you",
// "failed"), no pink (reads red as a thin stripe), no lime (near yellow), and
// no grape, which is the acting-for banner's.
const PALETTE = ["blue", "teal", "indigo", "cyan", "violet", "green"];

export const personColor = (userId: number): string => PALETTE[userId % PALETTE.length]!;
