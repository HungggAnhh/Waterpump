import { useState, useEffect, useCallback } from 'react';
import { audioManager } from '../services/audio/audioManager';

export function useAudioPlayer(messageId: string | number) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0); // in milliseconds
  const [duration, setDuration] = useState(0); // in milliseconds
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPlaybackStatusUpdate = useCallback((status: any) => {
    if (!status.isLoaded) {
      if (status.error) {
        setError(`Playback error: ${status.error}`);
      }
      return;
    }

    setIsPlaying(status.isPlaying);
    setPosition(status.positionMillis);
    if (status.durationMillis) {
      setDuration(status.durationMillis);
    }
  }, []);

  const play = useCallback(async (sourceUrl: string) => {
    setIsLoading(true);
    setError(null);
    try {
      await audioManager.play(messageId, sourceUrl, onPlaybackStatusUpdate);
    } catch (err: any) {
      setError(err?.message || 'Không thể phát âm thanh.');
    } finally {
      setIsLoading(false);
    }
  }, [messageId, onPlaybackStatusUpdate]);

  const pause = useCallback(async () => {
    try {
      await audioManager.pause(messageId);
    } catch (err) {
      console.error('Failed to pause in hook:', err);
    }
  }, [messageId]);

  const resume = useCallback(async () => {
    try {
      await audioManager.resume(messageId);
    } catch (err) {
      console.error('Failed to resume in hook:', err);
    }
  }, [messageId]);

  const stop = useCallback(async () => {
    try {
      await audioManager.stop(messageId);
    } catch (err) {
      console.error('Failed to stop in hook:', err);
    }
  }, [messageId]);

  const seek = useCallback(async (positionMs: number) => {
    try {
      await audioManager.seek(messageId, positionMs);
      setPosition(positionMs);
    } catch (err) {
      console.error('Failed to seek in hook:', err);
    }
  }, [messageId]);

  const unload = useCallback(async () => {
    try {
      await audioManager.unload(messageId);
    } catch (err) {
      console.error('Failed to unload in hook:', err);
    }
  }, [messageId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      audioManager.unload(messageId).catch((err) => {
        console.error('Failed to unload on unmount in useAudioPlayer:', err);
      });
    };
  }, [messageId]);

  return {
    isPlaying,
    position,
    duration,
    isLoading,
    error,
    play,
    pause,
    resume,
    stop,
    seek,
    unload,
  };
}
export default useAudioPlayer;
