'use client';

import { LiveKitRoom, RoomAudioRenderer, StartAudio } from '@livekit/components-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Report } from '@/components/Report';
import { RoomErrorGuard } from '@/components/RoomErrorGuard';
import { RequireAuth, Shell } from '@/components/Shell';
import { VoiceRoom } from '@/components/VoiceRoom';
import { ApiError, api, errorMessage } from '@/lib/api';
import { friendlyRoomError, micErrorMessage } from '@/lib/format';
import { isRoomTeardownError } from '@/lib/useLiveTranscript';
import type { InterviewDetail } from '@/lib/types';

type Phase = 'loading' | 'ready' | 'joining' | 'live' | 'finishing' | 'done' | 'busy' | 'error';

const MIC_LOST =
  'We lost access to your microphone. Check that it is plugged in and allowed for this site, then use the Unmute button.';

/** Asks for the microphone before the interview is touched, so a blocked mic never uses the interview up. */
async function checkMicrophone(): Promise<string | null> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'This browser cannot use a microphone here. Use a current Chrome, Edge, Safari or Firefox over HTTPS.';
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return null;
  } catch (err) {
    return micErrorMessage(err);
  }
}

function InterviewScreen() {
  const { id } = useParams<{ id: string }>();
  const [phase, setPhase] = useState<Phase>('loading');
  const [interview, setInterview] = useState<InterviewDetail | null>(null);
  const [conn, setConn] = useState<{ token: string; serverUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

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
    } catch (err) {
      // The results are saved either way; an expired sign-in only stops us from showing them here.
      if (err instanceof ApiError && err.status === 401) setSessionExpired(true);
      // Other errors are transient; the next tick retries.
    }
  }, [id]);

  useEffect(() => {
    if (phase !== 'live' && phase !== 'finishing' && phase !== 'busy') return;
    if (sessionExpired) return;
    const startedAt = Date.now();
    let ticks = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      void poll();
      if (Date.now() - startedAt > 60_000) setSlow(true);
      ticks += 1;
      // 2.5 s at first, easing off to 10 s so a long wait does not hammer the API.
      timer = setTimeout(tick, Math.min(2500 * 1.25 ** ticks, 10_000));
    };
    timer = setTimeout(tick, 2500);
    return () => clearTimeout(timer);
  }, [phase, poll, sessionExpired]);

  // Closing the tab by accident ends (or pauses) a live interview, so ask first.
  useEffect(() => {
    if (phase !== 'live') return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [phase]);

  async function join() {
    setError(null);
    setRoomError(null);
    phaseRef.current = 'joining'; // so the old room unmounting during a retry is not mistaken for the end
    setPhase('joining');
    const micProblem = await checkMicrophone();
    if (micProblem) {
      setError(micProblem);
      phaseRef.current = 'ready';
      setPhase('ready');
      return;
    }
    try {
      const data = await api<{ token: string; serverUrl: string }>(`/interviews/${id}/token`, {
        method: 'POST',
        body: {},
      });
      setConn({ token: data.token, serverUrl: data.serverUrl });
      setPhase('live');
    } catch (err) {
      setError(errorMessage(err));
      // A refused rejoin means the interview is no longer open: show where it stands instead of a dead button.
      const closed = err instanceof ApiError && err.code === 'INTERVIEW_NOT_JOINABLE';
      phaseRef.current = closed ? 'busy' : 'ready';
      setPhase(closed ? 'busy' : 'ready');
    }
  }

  function retry() {
    setConn(null);
    void join();
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
          <h1 className="h1">
            {interview?.canRejoin
              ? 'You were disconnected'
              : phase === 'finishing'
                ? 'Saving your results'
                : 'This interview is still open'}
          </h1>
          <p className="lede" role="status">
            {interview?.canRejoin
              ? 'The interviewer is holding your place for a short time. Rejoin to carry on where you left off.'
              : phase === 'finishing'
                ? 'The interviewer is writing your summary. This usually takes a few seconds.'
                : 'It is running in another tab, or it just ended. Your feedback appears here as soon as it is saved.'}
          </p>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {interview?.canRejoin && (
            <button className="btn btn--lg" type="button" onClick={join}>
              Rejoin interview
            </button>
          )}
          {sessionExpired && (
            <p className="notice" role="status">
              Your sign-in expired. Your results are saved.{' '}
              <Link href="/login">Sign in again</Link> to see them.
            </p>
          )}
          {slow && !sessionExpired && (
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
          <RoomErrorGuard />
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
            onError={(err) => {
              if (!isRoomTeardownError(err)) setRoomError(friendlyRoomError(err));
            }}
            onMediaDeviceFailure={() => setRoomError(MIC_LOST)}
          >
            <VoiceRoom maxMinutes={interview.maxMinutes} onRetry={retry} />
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
