'use client';

import { useRoomContext } from '@livekit/components-react';
import { DataStreamError, DataStreamErrorReason, type TextStreamReader } from 'livekit-client';
import { useEffect, useState } from 'react';

const TOPIC = 'lk.transcription';
const SEGMENT_ATTRIBUTE = 'lk.segment_id';

export interface LiveSegment {
  /** Stable for the life of a segment, even as interim updates arrive on new streams. */
  id: string;
  text: string;
  identity: string;
  /** Timestamp of the first stream for this segment, so ordering does not jump while text is updated. */
  at: number;
}

/** The SDK errors in-flight streams on purpose when the room closes; that is not a failure. */
export function isRoomTeardownError(err: unknown): boolean {
  return err instanceof DataStreamError && err.reason === DataStreamErrorReason.AbnormalEnd;
}

/**
 * Live transcript of the conversation (the interviewer's speech and the candidate's STT).
 *
 * Replaces `useTranscriptions()` from @livekit/components-react. Its stream subscription has no error handler,
 * so ending the interview while a transcript chunk was still arriving surfaced as an uncaught
 * "Room disconnected in the middle of receiving data" DataStreamError. Here every stream read is guarded.
 */
export function useLiveTranscript(): LiveSegment[] {
  const room = useRoomContext();
  const [segments, setSegments] = useState<LiveSegment[]>([]);

  useEffect(() => {
    let active = true;

    const upsert = (id: string, text: string, identity: string, at: number) => {
      setSegments((prev) => {
        const index = prev.findIndex((s) => s.id === id);
        if (index === -1) return [...prev, { id, text, identity, at }];
        const next = prev.slice();
        next[index] = { ...next[index], text };
        return next;
      });
    };

    const handler = async (reader: TextStreamReader, participant: { identity: string }) => {
      const id = reader.info.attributes?.[SEGMENT_ATTRIBUTE] || reader.info.id;
      let text = '';
      try {
        for await (const chunk of reader) {
          if (!active) return;
          text += chunk;
          upsert(id, text, participant.identity, reader.info.timestamp);
        }
      } catch (err) {
        if (!isRoomTeardownError(err)) console.warn('Transcript stream ended unexpectedly', err);
      }
    };

    try {
      room.registerTextStreamHandler(TOPIC, handler);
    } catch (err) {
      console.warn('Could not register the transcript handler', err);
    }

    return () => {
      active = false;
      room.unregisterTextStreamHandler(TOPIC);
    };
  }, [room]);

  return segments;
}
