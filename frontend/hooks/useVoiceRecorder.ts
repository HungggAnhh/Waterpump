import { useState, useRef, useEffect, useCallback } from 'react';
import { recorderService } from '../services/audio/recorder';

export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const requestPermission = useCallback(async () => {
    return await recorderService.requestPermissions();
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    setDuration(0);
    timerRef.current = setInterval(() => {
      setDuration((prev) => prev + 1);
    }, 1000);
  }, [stopTimer]);

  const startRecording = useCallback(async () => {
    try {
      await recorderService.start();
      setIsRecording(true);
      startTimer();
    } catch (error) {
      console.error('Failed to start recording:', error);
      setIsRecording(false);
      stopTimer();
      throw error;
    }
  }, [startTimer, stopTimer]);

  const stopRecording = useCallback(async (): Promise<{ uri: string | null; duration: number }> => {
    stopTimer();
    setIsRecording(false);

    try {
      const uri = await recorderService.stop();
      const finalDuration = duration;
      setDuration(0);
      return { uri, duration: finalDuration };
    } catch (error) {
      console.error('Failed to stop recording:', error);
      setDuration(0);
      return { uri: null, duration: 0 };
    }
  }, [duration, stopTimer]);

  const cancelRecording = useCallback(async () => {
    stopTimer();
    setIsRecording(false);
    setDuration(0);
    try {
      await recorderService.cancel();
    } catch (error) {
      console.error('Failed to cancel recording:', error);
    }
  }, [stopTimer]);

  // Handle auto-stop at 5 minutes (300 seconds)
  useEffect(() => {
    if (duration >= 300 && isRecording) {
      stopRecording();
    }
  }, [duration, isRecording, stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimer();
      recorderService.cancel().catch(() => {});
    };
  }, [stopTimer]);

  return {
    isRecording,
    duration,
    startRecording,
    stopRecording,
    cancelRecording,
    requestPermission,
  };
}
