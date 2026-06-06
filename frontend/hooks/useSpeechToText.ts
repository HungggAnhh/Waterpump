import { useEffect, useState, useRef, useCallback } from 'react';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

export interface UseSpeechToTextProps {
  onTranscript: (transcript: string) => void;
  onError?: (errorMessage: string) => void;
}

export function useSpeechToText({ onTranscript, onError }: UseSpeechToTextProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [isStarting, setIsStarting] = useState(false);

  const silenceTimeoutRef = useRef<any>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);

  // Keep references fresh to avoid re-binding listeners
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Check speech recognition compatibility on mount
  useEffect(() => {
    try {
      const available = ExpoSpeechRecognitionModule.isRecognitionAvailable();
      setIsSupported(!!available);
    } catch (e) {
      setIsSupported(false);
    }
  }, []);

  // Silence Timer logic: stops recognition if no speech activity is detected for 10 seconds
  const resetSilenceTimer = useCallback(() => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
    silenceTimeoutRef.current = setTimeout(() => {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch (err) {
        console.warn("Silence timeout: failed to abort", err);
      }
      setIsListening(false);
      setIsStarting(false);
      if (onErrorRef.current) {
        onErrorRef.current("Không nhận diện được giọng nói. Vui lòng thử lại.");
      }
    }, 10000);
  }, []);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
  }, []);

  // Register listeners exactly once and handle teardown on unmount
  useEffect(() => {
    const subscriptions: { remove: () => void }[] = [];

    try {
      subscriptions.push(
        ExpoSpeechRecognitionModule.addListener('start', () => {
          setIsListening(true);
          setIsStarting(false);
          resetSilenceTimer();
        })
      );

      subscriptions.push(
        ExpoSpeechRecognitionModule.addListener('end', () => {
          setIsListening(false);
          setIsStarting(false);
          clearSilenceTimer();
        })
      );

      subscriptions.push(
        ExpoSpeechRecognitionModule.addListener('result', (event: any) => {
          // Reset silence timer on any speech result (interim or final)
          resetSilenceTimer();

          const result = event.results?.[0];
          if (result && result.isFinal) {
            const finalTranscript = result.transcript;
            if (finalTranscript && finalTranscript.trim()) {
              if (onTranscriptRef.current) {
                onTranscriptRef.current(finalTranscript);
              }
            }
          }
        })
      );

      subscriptions.push(
        ExpoSpeechRecognitionModule.addListener('error', (event: any) => {
          setIsListening(false);
          setIsStarting(false);
          clearSilenceTimer();

          const errorCode = event.error;
          let message = "Có lỗi xảy ra trong quá trình nhận diện giọng nói.";
          if (errorCode === 'not-allowed') {
            message = "Vui lòng cấp quyền sử dụng Microphone.";
          } else if (errorCode === 'no-speech') {
            message = "Không nhận diện được giọng nói. Vui lòng thử lại.";
          }
          if (onErrorRef.current) {
            onErrorRef.current(message);
          }
        })
      );
    } catch (e) {
      console.error("Failed to register speech recognition listeners", e);
    }

    // Cleanup: remove all speech recognition listeners and clear timers on unmount
    return () => {
      subscriptions.forEach((sub) => {
        try {
          sub.remove();
        } catch (err) {
          // Ignore removal errors
        }
      });
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
    };
  }, [resetSilenceTimer, clearSilenceTimer]);

  const startListening = useCallback(async () => {
    // Microphone Button Safety: prevent rapid repeated taps or multiple active sessions
    if (isListening || isStarting) {
      return;
    }

    setIsStarting(true);

    try {
      // 1. Check browser/system availability
      const available = ExpoSpeechRecognitionModule.isRecognitionAvailable();
      if (!available) {
        setIsStarting(false);
        if (onErrorRef.current) {
          onErrorRef.current("Trình duyệt hiện tại không hỗ trợ nhận diện giọng nói.");
        }
        return;
      }

      // 2. Dynamic permission request
      const permission = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
      if (permission.status !== 'granted') {
        setIsStarting(false);
        if (onErrorRef.current) {
          onErrorRef.current("Vui lòng cấp quyền sử dụng Microphone.");
        }
        return;
      }

      // 3. Initiate speech recognition
      await ExpoSpeechRecognitionModule.start({
        lang: 'vi-VN',
        interimResults: true, // required to reset silence timer on interim speech
        continuous: false,
      });
    } catch (err: any) {
      setIsStarting(false);
      setIsListening(false);
      if (onErrorRef.current) {
        onErrorRef.current("Không thể khởi động nhận diện giọng nói. Vui lòng thử lại.");
      }
    }
  }, [isListening, isStarting]);

  const stopListening = useCallback(async () => {
    try {
      await ExpoSpeechRecognitionModule.stop();
    } catch (err) {
      // Ignore stop errors
    }
    setIsListening(false);
    setIsStarting(false);
    clearSilenceTimer();
  }, [clearSilenceTimer]);

  return {
    isListening,
    isStarting,
    isSupported,
    startListening,
    stopListening,
  };
}
