import Link from 'next/link';
import { durationMinutes, endedByLabel, formatDateTime, RATING_LABELS } from '@/lib/format';
import { STAGES, type Assessment, type InterviewDetail } from '@/lib/types';
import { RatingMeter } from './RatingMeter';

function AnswersByStage({ assessments }: { assessments: Assessment[] }) {
  return (
    <div className="answers">
      {STAGES.map((stage) => {
        const items = assessments.filter((a) => a.stage === stage.id);
        if (items.length === 0) return null;
        return (
          <section key={stage.id} aria-label={stage.name}>
            <h3 className="answers__stage">{stage.name}</h3>
            {items.map((a, i) => (
              <div className="answer" key={`${stage.id}-${i}`}>
                <p className="answer__topic">{a.topic}</p>
                <RatingMeter rating={a.rating} />
                <p className="answer__notes">{a.notes}</p>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

export function Report({ interview }: { interview: InterviewDetail }) {
  const { report, transcript, assessments } = interview;
  const minutes = durationMinutes(interview.startedAt, interview.endedAt);
  const spoke = transcript.some((t) => t.role === 'user');

  return (
    <div className="stack stack--xl">
      <header className="stack">
        <p className="muted">
          {interview.targetRole ?? 'Interview'} on {formatDateTime(interview.startedAt ?? interview.createdAt)}
        </p>
        <h1 className="h1">{interview.status === 'failed' ? 'This interview did not run' : 'Your interview feedback'}</h1>
        <p className="muted">
          {endedByLabel(interview.endedBy)}
          {minutes ? `, ${minutes} minute${minutes === 1 ? '' : 's'}` : ''}
        </p>
      </header>

      {interview.status === 'failed' && !spoke && (
        <div className="notice" role="status">
          <p>
            {interview.endedBy === 'provider_error'
              ? 'The interviewer had a technical problem before you could answer, so there is nothing to assess. Please start a new interview from your dashboard in a few minutes.'
              : 'We did not hear any answers, so there is nothing to assess. Check that your microphone is allowed for this site, then start a new interview from your dashboard.'}
          </p>
        </div>
      )}

      {report ? (
        <>
          <section className="stack" aria-label="Overall rating">
            <div className="score">
              <p className="score__num">
                {report.overallRating}
                <span className="score__of">out of 5</span>
              </p>
              <div className="stack" style={{ '--stack': '0.35rem' } as React.CSSProperties}>
                <RatingMeter rating={report.overallRating} large />
                <p className="h3">{RATING_LABELS[report.overallRating]}</p>
              </div>
            </div>
            <p className="read">{report.summary}</p>
          </section>

          <div className="cols">
            <section className="stack" aria-label="What went well">
              <h2 className="h2">What went well</h2>
              {report.strengths.length > 0 ? (
                <ul className="bullets">
                  {report.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No standout strengths were recorded.</p>
              )}
            </section>
            <section className="stack" aria-label="What to work on">
              <h2 className="h2">What to work on</h2>
              {report.improvements.length > 0 ? (
                <ul className="bullets">
                  {report.improvements.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No specific areas were recorded.</p>
              )}
            </section>
          </div>
        </>
      ) : (
        spoke && (
          <div className="notice" role="status">
            <p>The interview ended before a summary could be written. Your transcript is below.</p>
          </div>
        )
      )}

      {assessments.length > 0 && (
        <section className="stack" aria-label="Answer by answer">
          <h2 className="h2">Answer by answer</h2>
          <AnswersByStage assessments={assessments} />
        </section>
      )}

      {transcript.length > 0 && (
        <section className="stack" aria-label="Transcript">
          <h2 className="h2">Full transcript</h2>
          <details className="resume-read">
            <summary>Show the conversation</summary>
            <div style={{ marginTop: '0.75rem' }}>
              {transcript.map((t, i) => (
                <div className="turn" key={i} data-mine={t.role === 'user' ? 'true' : 'false'}>
                  <p className="turn__who">{t.role === 'user' ? 'You' : 'Interviewer'}</p>
                  <p className="turn__text">{t.text}</p>
                </div>
              ))}
            </div>
          </details>
        </section>
      )}

      <div className="row">
        <Link className="btn" href="/dashboard">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
