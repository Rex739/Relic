export const REVIEW_STAGE_DELAY_MS = 650;
export const REVIEW_REQUEST_TIMEOUT_MS = 10000;

export function getInitialVisibleAgentCount(agentCount: number, reduceMotion: boolean): number {
  return reduceMotion ? agentCount : 0;
}

export function isReviewComplete(visibleAgents: number, agentCount: number): boolean {
  return visibleAgents >= agentCount;
}

export function nextVisibleAgentCount(currentVisibleAgents: number, nextVisibleAgents: number): number {
  return Math.max(currentVisibleAgents, nextVisibleAgents);
}
