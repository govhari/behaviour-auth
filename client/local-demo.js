import { randomId } from './sdk.js';
export const LOCAL_ENROLLMENT_KEY = 'abc-bioprint-local';
export const DEMO_PASSWORD_MIN = 8;

const SESSION_KEY = 'bioprint.recording-visit';
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
let visit;

export function recordingSessionLabel(userId) {
  const now = Date.now();
  if (!visit) {
    try { visit = JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { /* Storage may be unavailable. */ }
  }
  if (!visit || typeof visit.id !== 'string' || !Number.isFinite(visit.lastSeen)
      || now - visit.lastSeen >= IDLE_TIMEOUT_MS || now < visit.lastSeen) {
    visit = { id: `${new Date(now).toISOString()}-${randomId()}`, lastSeen: now };
  }
  visit.lastSeen = now;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(visit)); } catch { /* Keep the in-memory visit. */ }
  return `${String(userId).slice(0, 64)}-${visit.id}`;
}
