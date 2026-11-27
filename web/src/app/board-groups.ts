/**
 * Gruppierungen und Default-Ansicht des Boards (ui.md §2.8), getrennt vom Modell der Bahnen: Die
 * Einstellungen der Oberfläche brauchen sie im Initial-Chunk, die Bahnenlogik bleibt im Board-Chunk.
 */
export type BoardGroup = 'sprint' | 'project' | 'repo' | 'none';
export type BoardView = { group: BoardGroup; showBacklog: boolean };
export const DEFAULT_BOARD_VIEW: BoardView = { group: 'sprint', showBacklog: false };
export const BOARD_GROUPS: readonly BoardGroup[] = ['sprint', 'project', 'repo', 'none'];
