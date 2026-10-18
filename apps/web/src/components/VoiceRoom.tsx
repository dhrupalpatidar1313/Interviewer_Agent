'use client';

import {
  useLocalParticipant,
  useMultibandTrackVolume,
  useRoomContext,
  useTrackToggle,
  useTranscriptions,
  useVoiceAssistant,
} from '@livekit/components-react';
import { Track, type LocalAudioTrack } from 'livekit-client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatClock } from '@/lib/format';
import { STAGES, type Stage } from '@/lib/types';
import { StageRail } from './StageRail';

const BANDS = 44;
type TrackArg = Parameters<typeof useMultibandTrackVolume>[0];

function LiveBars({ track, kind, muted = false }: { track: TrackArg; kind: 'agent' | 'you'; muted?: boolean }) {
  const bands = useMultibandTrackVolume(track, { bands: BANDS, loPass: 10, hiPass: 360 });
  const values = bands.length === BANDS ? bands : new Array<number>(BANDS).fill(0);
  return (
    <div className={`live live--${kind}`} data-muted={muted ? 'true' : 'false'} aria-hidden="true">
      {values.map((v, i) => (
        <span key={i} className="live__bar" style={{ transform: `scaleY(${Math.max(0.05, Math.min(1, v * 1.6))})` }} />
      ))}
    </div>
  );
}

function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return seconds;
}

function stateCopy(state: string, name: string): string {
  switch (state) {
    case 'speaking':
      return `${name} is speaking`;
    case 'thinking':
      return `${name} is thinking`;
    case 'listening':
      return `${name} is listening`;
    case 'initializing':
      return `${name} is getting ready`;
    case 'idle':
      return `${name} is waiting`;
    case 'failed':
      return `${name} could not join`;
    case 'connecting':
    case 'pre-connect-buffering':
      return 'Connecting';
    default:
      return `Waiting for ${name} to join`;
  }
}

const STAGE_IDS = new Set<string>(STAGES.map((s) => s.id));

/** Must render inside <LiveKitRoom>. */
export function VoiceRoom({ maxMinutes }: { maxMinutes: number }) {
  const room = useRoomContext();
  const { state, audioTrack, agentAttributes } = useVoiceAssistant();
  const { localParticipant, microphoneTrack } = useLocalParticipant();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const segments = useTranscriptions();
  const seconds = useElapsedSeconds();
  const [confirming, setConfirming] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const interviewer = agentAttributes?.interviewer_name || 'Alex';
  const rawStage = agentAttributes?.interview_stage;
  const stage: Stage | null = rawStage && STAGE_IDS.has(rawStage) ? (rawStage as Stage) : null;
  const micTrack = microphoneTrack?.track as LocalAudioTrack | undefined;

  const turns = useMemo(
    () =>
      segments
        .map((s) => ({
          id: s.streamInfo.id,
          text: s.text,
          mine: s.participantInfo.identity === localParticipant.identity,
          at: s.streamInfo.timestamp,
        }))
        .filter((t) => t.text.trim().length > 0)
        .sort((a, b) => a.at - b.at),
    [segments, localParticipant.identity],
  );

  const lastText = turns.length ? turns[turns.length - 1].text : '';
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, lastText]);

  return (
    <div className="room">
      <StageRail current={stage} />

      <div className="room__grid">
        <section className="voice" aria-label="Voice conversation">
          <p className="voice__state" role="status" aria-live="polite">
            {stateCopy(state, interviewer)}
          </p>

          <div>
            <div className="voice__label">
              <span>{interviewer}</span>
            </div>
            <LiveBars track={audioTrack} kind="agent" />
          </div>

          <div>
            <div className="voice__label">
              <span>You</span>
              <span className="muted small">{mic.enabled ? 'Microphone on' : 'Microphone muted'}</span>
            </div>
            <LiveBars track={micTrack} kind="you" muted={!mic.enabled} />
          </div>

          <div className="controls">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => mic.toggle()}
              disabled={mic.pending}
              aria-pressed={!mic.enabled}
            >
              {mic.enabled ? 'Mute microphone' : 'Unmute microphone'}
            </button>

            {confirming ? (
              <>
                <button type="button" className="btn btn--danger" onClick={() => void room.disconnect()}>
                  End and save
                </button>
                <button type="button" className="btn btn--quiet" onClick={() => setConfirming(false)}>
                  Keep going
                </button>
              </>
            ) : (
              <button type="button" className="btn btn--quiet" onClick={() => setConfirming(true)}>
                End interview
              </button>
            )}

            <span className="clock" aria-label="Time elapsed">
              {formatClock(seconds)} of about {maxMinutes} min
            </span>
          </div>
          {confirming && <p className="muted small">What you have answered so far will be saved with a summary.</p>}
        </section>

        <section aria-label="Live transcript">
          <h2 className="h3" style={{ marginBottom: '0.75rem' }}>
            Transcript
          </h2>
          <div className="transcript" ref={listRef}>
            {turns.length === 0 ? (
              <p className="muted">The conversation will appear here as you talk.</p>
            ) : (
              turns.map((t) => (
                <div className="turn" key={t.id} data-mine={t.mine ? 'true' : 'false'}>
                  <p className="turn__who">{t.mine ? 'You' : interviewer}</p>
                  <p className="turn__text">{t.text}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
