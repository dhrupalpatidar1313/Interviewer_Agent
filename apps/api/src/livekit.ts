import { RoomAgentDispatch, RoomConfiguration } from '@livekit/protocol';
import { AccessToken } from 'livekit-server-sdk';
import { env } from './env.js';

/** The identity the candidate joins the room with. The agent restricts itself to this identity. */
export function participantIdentity(userId: string): string {
  return `user-${userId}`;
}

/**
 * Mints a join token for the candidate. The embedded RoomConfiguration dispatches the interviewer agent
 * (by name) as soon as the room is created, passing the interview id as job metadata.
 * Rooms are unique per interview, so the dispatch always applies on first join.
 */
export async function createCandidateToken(opts: {
  userId: string;
  displayName: string;
  roomName: string;
  interviewId: string;
}): Promise<string> {
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: participantIdentity(opts.userId),
    name: opts.displayName,
    ttl: '1h',
  });
  at.addGrant({
    roomJoin: true,
    room: opts.roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  at.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: env.AGENT_NAME,
        metadata: JSON.stringify({ interviewId: opts.interviewId }),
      }),
    ],
  });
  return at.toJwt();
}

export function clientServerUrl(): string {
  return env.LIVEKIT_PUBLIC_URL ?? env.LIVEKIT_URL;
}
