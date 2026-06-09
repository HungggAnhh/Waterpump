import { Platform } from 'react-native';

class SoundEffects {
  private static ctx: AudioContext | null = null;

  private static getContext() {
    if (typeof window === 'undefined') return null;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!this.ctx) {
      this.ctx = new AudioContextClass();
    }
    return this.ctx;
  }

  static play(type: 'message' | 'assignment' | 'success' | 'warning') {
    try {
      const ctx = this.getContext();
      if (!ctx) {
        // Fallback to HTML5 audio if browser supports it but AudioContext is blocked
        if (typeof Audio !== 'undefined') {
          const audio = new Audio('/sounds/notification.wav');
          audio.volume = 0.5;
          audio.play().catch(() => {});
        }
        return;
      }

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;
      if (type === 'message') {
        // Quick pleasant chirp: 600Hz -> 850Hz in 0.12s
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(850, now + 0.12);
        
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        
        osc.start(now);
        osc.stop(now + 0.14);
      } else if (type === 'assignment') {
        // Rising chime notes: C5 (523Hz) -> E5 (659Hz)
        const notes = [523, 659];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.1);
          
          gain.gain.setValueAtTime(0, now + idx * 0.1);
          gain.gain.linearRampToValueAtTime(0.15, now + idx * 0.1 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.005, now + idx * 0.1 + 0.18);
          
          osc.start(now + idx * 0.1);
          osc.stop(now + idx * 0.1 + 0.2);
        });
      } else if (type === 'success') {
        // Ascending major chime chord: C5 (523Hz) -> E5 (659Hz) -> G5 (784Hz) -> C6 (1046Hz)
        const notes = [523, 659, 784, 1046];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.08);
          
          gain.gain.setValueAtTime(0, now + idx * 0.08);
          gain.gain.linearRampToValueAtTime(0.12, now + idx * 0.08 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.25);
          
          osc.start(now + idx * 0.08);
          osc.stop(now + idx * 0.08 + 0.3);
        });
      } else if (type === 'warning') {
        // Alert beep: double warning tone
        [0, 0.22].forEach((delay) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(220, now + delay);
          
          gain.gain.setValueAtTime(0.1, now + delay);
          gain.gain.linearRampToValueAtTime(0.1, now + delay + 0.12);
          gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.18);
          
          osc.start(now + delay);
          osc.stop(now + delay + 0.2);
        });
      }
    } catch (err) {
      console.warn('Could not synthesize sound effect:', err);
    }
  }
}

interface SpeechItem {
  text: string;
  soundType?: 'message' | 'assignment' | 'success' | 'warning';
}

class VoiceNotificationService {
  private queue: SpeechItem[] = [];
  private isSpeaking = false;
  private lastSpokenTime = 0;
  private lastSpokenText = '';
  private lastSpeechEnd = 0;

  // Web Speech API check
  private isSpeechSupported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  // Speak queue processor
  private processQueue = () => {
    if (!this.isSpeechSupported()) return;

    if (this.isSpeaking || this.queue.length === 0) return;

    // Enforce 1 second delay between speech items
    const now = Date.now();
    const timeSinceLastSpeech = now - this.lastSpeechEnd;
    if (timeSinceLastSpeech < 1000) {
      setTimeout(this.processQueue, 1000 - timeSinceLastSpeech);
      return;
    }

    const nextItem = this.queue.shift();
    if (!nextItem) return;

    // Play chime sound before speech
    if (nextItem.soundType) {
      SoundEffects.play(nextItem.soundType);
    }

    // Prepare utterance
    const utterance = new SpeechSynthesisUtterance(nextItem.text);
    utterance.lang = 'vi-VN';
    
    // Attempt to select a Vietnamese voice if available
    const voices = window.speechSynthesis.getVoices();
    const viVoice = voices.find(v => v.lang === 'vi-VN' || v.lang.includes('vi'));
    if (viVoice) {
      utterance.voice = viVoice;
    }

    utterance.onstart = () => {
      this.isSpeaking = true;
      this.lastSpokenTime = Date.now();
      this.lastSpokenText = nextItem.text;
    };

    const handleSpeechEnd = () => {
      this.isSpeaking = false;
      this.lastSpeechEnd = Date.now();
      // Wait at least 1 second before processing next item
      setTimeout(this.processQueue, 1000);
    };

    utterance.onend = handleSpeechEnd;
    utterance.onerror = handleSpeechEnd;

    // Speak
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('SpeechSynthesis speak error:', err);
      this.isSpeaking = false;
      this.processQueue();
    }
  };

  /**
   * Queue a text description to read in Vietnamese.
   */
  speak(text: string, soundType?: 'message' | 'assignment' | 'success' | 'warning') {
    if (!this.isSpeechSupported()) return;

    const now = Date.now();
    
    // Deduplication check: ignore if same text spoken in last 3 seconds
    if (text === this.lastSpokenText && now - this.lastSpokenTime < 3000) {
      console.log('VoiceNotificationService: Ignored duplicate text:', text);
      return;
    }

    this.queue.push({ text, soundType });
    this.processQueue();
  }

  // --- Specialized notification builders ---

  speakMessage(senderName: string, count = 1) {
    if (count > 1) {
      this.speak(`${senderName} vừa gửi ${count} tin nhắn cho bạn`, 'message');
    } else {
      this.speak(`${senderName} vừa gửi tin nhắn cho bạn`, 'message');
    }
  }

  speakTaskAssigned(taskTitle: string) {
    this.speak(`Bạn vừa được giao nhiệm vụ: ${taskTitle}`, 'assignment');
  }

  speakTaskViewed(viewerName: string) {
    this.speak(`${viewerName} đã xem nhiệm vụ`, 'message');
  }

  speakTaskStarted(userName: string) {
    this.speak(`${userName} vừa bắt đầu thực hiện nhiệm vụ`, 'message');
  }

  speakTaskReport(userName: string, progress: number) {
    this.speak(`${userName} vừa cập nhật tiến độ ${progress} phần trăm`, 'message');
  }

  speakTaskCompleted(userName: string) {
    this.speak(`${userName} đã hoàn thành nhiệm vụ`, 'success');
  }

  speakTaskRejected() {
    this.speak(`Nhiệm vụ vừa bị trả lại để chỉnh sửa`, 'warning');
  }

  speakTaskApproved() {
    this.speak(`Nhiệm vụ đã được phê duyệt`, 'success');
  }

  speakTaskUrged(userName: string, taskTitle: string) {
    this.speak(`${userName} đang hối thúc nhiệm vụ: ${taskTitle}`, 'warning');
  }

  speakOverdueTasks(count: number) {
    this.speak(`Có ${count} nhiệm vụ đã quá hạn cần xử lý`, 'warning');
  }
}

export const voiceNotification = new VoiceNotificationService();
