import { useEffect, useState, useRef, useCallback } from 'react';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

export interface UseSpeechToTextProps {
  onTranscript: (transcript: string) => void;
  onError?: (errorMessage: string) => void;
  onStart?: () => void;
}

export function useSpeechToText({ onTranscript, onError, onStart }: UseSpeechToTextProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [isStarting, setIsStarting] = useState(false);

  const silenceTimeoutRef = useRef<any>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  const onStartRef = useRef(onStart);
  const browserRecognitionRef = useRef<any>(null);

  // Keep references fresh to avoid re-binding listeners
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onStartRef.current = onStart;
  }, [onStart]);

  // Check speech recognition compatibility on mount
  useEffect(() => {
    try {
      const isExpoSupported = !!(
        ExpoSpeechRecognitionModule &&
        typeof ExpoSpeechRecognitionModule.isRecognitionAvailable === 'function' &&
        ExpoSpeechRecognitionModule.isRecognitionAvailable()
      );
      const isBrowserSupported = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
      setIsSupported(isExpoSupported || isBrowserSupported);
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
        if (browserRecognitionRef.current) {
          browserRecognitionRef.current.stop();
        } else {
          ExpoSpeechRecognitionModule.abort();
        }
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
          if (onStartRef.current) {
            onStartRef.current();
          }
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

          if (event.results && Array.isArray(event.results)) {
            const transcript = event.results.map((r: any) => r.transcript).join(' ');
            if (transcript && transcript.trim()) {
              if (onTranscriptRef.current) {
                onTranscriptRef.current(transcript);
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
      if (browserRecognitionRef.current) {
        try {
          browserRecognitionRef.current.stop();
        } catch (e) {}
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
      const isExpoSupported = ExpoSpeechRecognitionModule && typeof ExpoSpeechRecognitionModule.isRecognitionAvailable === 'function' && ExpoSpeechRecognitionModule.isRecognitionAvailable();
      const isBrowserSupported = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

      if (!isExpoSupported && isBrowserSupported) {
        console.log('[STT] Falling back to Web Speech API...');
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.lang = 'vi-VN';
        recognition.interimResults = true;
        recognition.continuous = true;

        recognition.onstart = () => {
          setIsListening(true);
          setIsStarting(false);
          resetSilenceTimer();
          if (onStartRef.current) {
            onStartRef.current();
          }
        };

        recognition.onend = () => {
          setIsListening(false);
          setIsStarting(false);
          clearSilenceTimer();
        };

        recognition.onresult = (event: any) => {
          resetSilenceTimer();
          const results = event.results;
          let transcript = '';
          for (let i = 0; i < results.length; ++i) {
            transcript += results[i][0].transcript;
          }
          if (transcript && transcript.trim()) {
            if (onTranscriptRef.current) {
              onTranscriptRef.current(transcript);
            }
          }
        };

        recognition.onerror = (event: any) => {
          console.error('[STT] Browser SpeechRecognition error:', event.error);
          setIsListening(false);
          setIsStarting(false);
          clearSilenceTimer();
          if (onErrorRef.current) {
            onErrorRef.current("Lỗi nhận diện giọng nói: " + event.error);
          }
        };

        browserRecognitionRef.current = recognition;
        recognition.start();
        return;
      }

      if (!isExpoSupported) {
        setIsStarting(false);
        if (onErrorRef.current) {
          onErrorRef.current("Trình duyệt hoặc thiết bị này không hỗ trợ nhận diện giọng nói.");
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
  }, [isListening, isStarting, resetSilenceTimer, clearSilenceTimer]);

  const stopListening = useCallback(async () => {
    setIsListening(false);
    setIsStarting(false);
    clearSilenceTimer();

    if (browserRecognitionRef.current) {
      try {
        browserRecognitionRef.current.stop();
      } catch (err) {}
      browserRecognitionRef.current = null;
    } else {
      try {
        const isExpoSupported = ExpoSpeechRecognitionModule && typeof ExpoSpeechRecognitionModule.isRecognitionAvailable === 'function' && ExpoSpeechRecognitionModule.isRecognitionAvailable();
        if (isExpoSupported) {
          await ExpoSpeechRecognitionModule.stop();
        }
      } catch (err) {
        // Ignore stop errors
      }
    }
  }, [clearSilenceTimer]);

  return {
    isListening,
    isStarting,
    isSupported,
    startListening,
    stopListening,
  };
}
export default useSpeechToText;
