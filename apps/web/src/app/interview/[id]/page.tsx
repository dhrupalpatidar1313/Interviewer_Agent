'use client';

import { LiveKitRoom, RoomAudioRenderer, StartAudio } from '@livekit/components-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Report } from '@/components/Report';
import { RequireAuth, Shell } from '@/components/Shell';
import { VoiceRoom } from '@/components/VoiceRoom';
import { api, errorMessage } from '@/lib/api';
import type { InterviewDetail } from '@/lib/types';

type Phase = 'loading' | 'ready' | 'joining' | 'live' | 'finishing' | 'done' | 'busy' | 'error';

const MIC_BLOCKED =
  'Your browser blocked the microphone. Allow microphone access for this site, then start a new interview from your dashboard.';

function InterviewScreen() {
  const { id } = useParams<{ id: string }>();
  const [phase, setPhase] = useState<Phase>('loading');
  const [interview, setInterview] = useState<InterviewDetail | null>(null);
  const [conn, setConn] = useState<{ token: string; serverUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);

  const phaseRef = useRef<Phase>(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Initial load decides which screen to show.
  useEffect(() => {
    let cancelled = false;
    api<{ interview: InterviewDetail }>(`/interviews/${id}`)
      .then(({ interview: iv }) => {
        if (cancelled) return;
        setInterview(iv);
        setPhase(iv.status === 'created' ? 'ready' : iv.status === 'in_progress' ? 'busy' : 'done');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errorMessage(err));
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // While live, finishing, or waiting on another tab, watch for the agent to report the results.
  const poll = useCallback(async () => {
    try {
      const { interview: iv } = await api<{ interview: InterviewDetail }>(`/interviews/${id}`);
      setInterview(iv);
      if (iv.status === 'completed' || iv.status === 'failed') {
        setConn(null); // leaving the room if we are still in it
        setPhase('done');
      }
    } catch {
      // Transient errors are fine; the next tick retries.
    }
  }, [id]);

  useEffect(() => {
    if (phase !== 'live' && phase !== 'finishing' && phase !== 'busy') return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      void poll();
      if (Date.now() - startedAt > 60_000) setSlow(true);
    }, 2500);
    return () => clearInterval(timer);
  }, [phase, poll]);

  async function join() {
    setError(null);
    setRoomError(null);
    setPhase('joining');
    try {
      const data = await api<{ token: string; serverUrl: string }>(`/interviews/${id}/token`, {
        method: 'POST',
        body: {},
      });
      setConn({ token: data.token, serverUrl: data.serverUrl });
      setPhase('live');
    } catch (err) {
      setError(errorMessage(err));
      setPhase('ready');
    }
  }

  if (phase === 'loading') {
    return (
      <div className="container page">
        <p className="muted" role="status">
          Loading…
        </p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="container container--narrow page">
        <div className="stack stack--lg">
          <h1 className="h1">We could not open this interview</h1>
          <p className="alert" role="alert">
            {error}
          </p>
          <Link className="btn" href="/dashboard">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (phase === 'done' && interview) {
    return (
      <div className="container container--narrow page">
        <Report interview={interview} />
      </div>
    );
  }

  if (phase === 'busy' || phase === 'finishing') {
    return (
      <div className="container container--narrow page">
        <div className="stack stack--lg">
          <h1 className="h1">{phase === 'finishing' ? 'Saving your results' : 'This interview is still open'}</h1>
          <p className="lede" role="status">
            {phase === 'finishing'
              ? 'The interviewer is writing your summary. This usually takes a few seconds.'
              : 'It is running in another tab, or it just ended. Your feedback appears here as soon as it is saved.'}
          </p>
          {slow && (
            <p className="notice">
              This is taking longer than usual. You can leave this page; your results will be on your dashboard once they
              are saved.
            </p>
          )}
          <Link className="btn btn--secondary" href="/dashboard">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  if ((phase === 'live' || phase === 'joining') && interview && conn) {
    return (
      <div className="container page">
        <div className="stack stack--lg">
          <p className="muted">Interviewing for {interview.targetRole ?? 'your role'}</p>
          {roomError && (
            <p className="alert" role="alert">
              {roomError}
            </p>
          )}
          <LiveKitRoom
            token={conn.token}
            serverUrl={conn.serverUrl}
            connect
            audio
            video={false}
            onDisconnected={() => {
              if (phaseRef.current === 'live') {
                setConn(null);
                setPhase('finishing');
              }
            }}
            onError={(err) => setRoomError(err.message)}
            onMediaDeviceFailure={() => setRoomError(MIC_BLOCKED)}
          >
            <VoiceRoom maxMinutes={interview.maxMinutes} />
            <RoomAudioRenderer />
            <div style={{ marginTop: '1rem' }}>
              <StartAudio label="Turn on sound" className="btn btn--secondary" />
            </div>
          </LiveKitRoom>
        </div>
      </div>
    );
  }

  // phase === 'ready' (or 'joining' before the token arrives)
  return (
    <div className="container container--narrow page">
      <div className="stack stack--lg">
        <div className="stack">
          <p className="muted">{interview?.targetRole ?? 'Interview'}</p>
          <h1 className="h1">Ready when you are</h1>
        </div>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <ul className="checks">
          <li>Find a quiet spot. Headphones stop the interviewer&rsquo;s voice leaking back into your microphone.</li>
          <li>Your browser will ask for microphone access. Choose Allow.</li>
          <li>
            It runs about {interview?.maxMinutes ?? 25} minutes and moves from easy questions to hard ones. Leaving early
            still saves what you have answered.
          </li>
        </ul>

        <div className="row">
          <button className="btn btn--lg" type="button" onClick={join} disabled={phase === 'joining'}>
            {phase === 'joining' ? 'Connecting…' : 'Start interview'}
          </button>
          <Link className="btn btn--lg btn--secondary" href="/dashboard">
            Not now
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function InterviewPage() {
  return (
    <Shell>
      <RequireAuth needsOnboarding>
        <InterviewScreen />
      </RequireAuth>
    </Shell>
  );
}
