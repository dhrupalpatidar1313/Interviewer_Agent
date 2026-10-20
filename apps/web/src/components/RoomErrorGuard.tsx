'use client';

import { useEffect } from 'react';
import { isRoomTeardownError } from '@/lib/useLiveTranscript';

/**
 * Safety net: swallows only the expected "room closed mid-stream" error if some other LiveKit hook leaves it
 * unhandled, so it neither pops the Next.js dev overlay nor pollutes the console. Everything else is untouched.
 */
export function RoomErrorGuard() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (!isRoomTeardownError(event.error)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isRoomTeardownError(event.reason)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('error', onError, true);
    window.addEventListener('unhandledrejection', onRejection, true);
    return () => {
      window.removeEventListener('error', onError, true);
      window.removeEventListener('unhandledrejection', onRejection, true);
    };
  }, []);

  return null;
}
