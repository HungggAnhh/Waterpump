// frontend/hooks/useWebRTC.ts
import { useState, useRef, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, mediaDevices } from '../utils/webrtcShim';
import { useCallStore, CallUserInfo, CallType } from '../store/useCallStore';
import { playRingtone, stopRingtone } from '../utils/webrtcShim';

const configuration = {
  iceServers: [
    // 1. Giữ lại STUN mặc định của Google để kết nối nội bộ
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },

    // 2. Điền thông tin TURN Server từ tài khoản Metered.ca của bạn
    {
      urls: 'stun:stun.relay.metered.ca:80',
    },
    {
      urls: 'turn:global.relay.metered.ca:80',
      username: 'b2655b37a3829e429930e412',
      credential: '2IBwInjeXje3G1Xo',
    },
    {
      urls: 'turn:global.relay.metered.ca:80?transport=tcp',
      username: 'b2655b37a3829e429930e412',
      credential: '2IBwInjeXje3G1Xo',
    },
    {
      urls: 'turn:global.relay.metered.ca:443',
      username: 'b2655b37a3829e429930e412',
      credential: '2IBwInjeXje3G1Xo',
    },
    {
      urls: 'turns:global.relay.metered.ca:443?transport=tcp',
      username: 'b2655b37a3829e429930e412',
      credential: '2IBwInjeXje3G1Xo',
    },
  ],
  iceCandidatePoolSize: 10
};

export const useWebRTC = (socketRef: React.RefObject<any>, currentUser: CallUserInfo) => {
  const {
    callState,
    callType,
    callerInfo,
    targetInfo,
    isMuted,
    isVideoOff,
    startCall: storeStartCall,
    setIncoming: storeSetIncoming,
    setConnected: storeSetConnected,
    toggleMute: storeToggleMute,
    toggleVideo: storeToggleVideo,
    setMuted: storeSetMuted,
    setVideoOff: storeSetVideoOff,
    resetCall: storeResetCall,
  } = useCallStore();

  const [localStream, setLocalStream] = useState<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);

  const pcRef = useRef<any>(null);
  const localStreamRef = useRef<any>(null);
  const remoteStreamRef = useRef<any>(null);
  const peerUserIdRef = useRef<number | null>(null);

  // 1. Tạo Peer Connection
  const createPeerConnection = useCallback((peerId: number) => {
    console.log('🔌 [useWebRTC:CREATE_PC] Khởi tạo RTCPeerConnection cho user:', peerId);
    
    if (pcRef.current) {
      console.log('⚠️ [useWebRTC:CREATE_PC] PeerConnection đã tồn tại, tiến hành đóng lại trước...');
      pcRef.current.close();
    }

    const pc = new RTCPeerConnection(configuration) as any;
    pcRef.current = pc;

    // Bắt đầu lắng nghe ICE Candidates tạo ra
    pc.onicecandidate = (event: any) => {
      if (event.candidate && socketRef.current) {
        // console.log('📡 [useWebRTC:ICE] Gửi ICE candidate tới:', peerId);
        socketRef.current.emit('ice_candidate', {
          toUserId: peerId,
          candidate: event.candidate,
        });
      }
    };

    // Bắng nghe nhận remote tracks
    pc.ontrack = (event: any) => {
      console.log('📡 [useWebRTC:ONTRACK] Nhận remote stream tracks:', event.streams);
      if (event.streams && event.streams[0]) {
        remoteStreamRef.current = event.streams[0];
        setRemoteStream(event.streams[0]);
      }
    };

    // Fallback cho một số phiên bản React Native WebRTC cũ
    pc.onaddstream = (event: any) => {
      console.log('📡 [useWebRTC:ONADDSTREAM] Nhận remote stream (onaddstream):', event.stream);
      if (event.stream) {
        remoteStreamRef.current = event.stream;
        setRemoteStream(event.stream);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('📡 [useWebRTC:STATE] Connection State thay đổi:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        storeSetConnected();
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        console.log('🚨 [useWebRTC:STATE] Kết nối gián đoạn hoặc thất bại. Tự động dọn dẹp...');
        handleHangUp(false);
      }
    };

    return pc;
  }, [socketRef, storeSetConnected]);

  // 2. Thu thập luồng camera & mic nội bộ
  const acquireMedia = useCallback(async (type: CallType) => {
    console.log('🔌 [useWebRTC:ACQUIRE_MEDIA] Yêu cầu luồng media, kiểu:', type);
    try {
      const constraints = {
        audio: true,
        video: type === 'video' ? {
          facingMode: 'user',
          width: 640,
          height: 480,
          frameRate: 30,
        } : false,
      };

      const stream = await mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (e: any) {
      console.error('❌ [useWebRTC:ACQUIRE_MEDIA] Lỗi thu thập camera/mic:', e);
      Alert.alert('Quyền truy cập', 'Không thể mở Camera/Mic của thiết bị. Hãy kiểm tra cài đặt quyền.');
      throw e;
    }
  }, []);

  // 3. Khởi tạo cuộc gọi (Caller)
  const startCall = useCallback(async (targetUser: CallUserInfo, type: CallType, conversationId?: string) => {
    console.log(`🔌 [useWebRTC:START_CALL] Gọi điện tới user ${targetUser.id} (${targetUser.name})`);
    peerUserIdRef.current = targetUser.id;
    
    // Đặt trạng thái store sang calling
    storeStartCall(targetUser, type, conversationId);
    playRingtone(); // Đổ chuông gọi đi

    try {
      // 1. Lấy luồng mic/camera trước
      await acquireMedia(type);

      // 2. Gửi tín hiệu gọi điện qua socket
      if (socketRef.current) {
        socketRef.current.emit('call_user', {
          toUserId: targetUser.id,
          callerInfo: currentUser,
          callType: type,
          conversationId,
        });
      }
    } catch (e) {
      handleHangUp(true);
    }
  }, [currentUser, socketRef, storeStartCall, acquireMedia]);

  // 4. Chấp nhận cuộc gọi (Receiver)
  const acceptCall = useCallback(async () => {
    const caller = callerInfo;
    const type = callType;
    if (!caller || !type) return;

    console.log(`🔌 [useWebRTC:ACCEPT_CALL] Chấp nhận cuộc gọi từ ${caller.id}`);
    peerUserIdRef.current = caller.id;
    stopRingtone();

    try {
      // Lấy camera / mic
      const stream = await acquireMedia(type);

      // Gửi tín hiệu chấp nhận cuộc gọi
      if (socketRef.current) {
        socketRef.current.emit('accept_call', { toUserId: caller.id });
      }

      // Tạo peer connection và add tracks
      const pc = createPeerConnection(caller.id);
      stream.getTracks().forEach((track: any) => {
        pc.addTrack(track, stream);
      });

      storeSetConnected();
    } catch (e) {
      handleHangUp(true);
    }
  }, [callerInfo, callType, acquireMedia, socketRef, createPeerConnection, storeSetConnected]);

  // 5. Từ chối cuộc gọi (Receiver)
  const rejectCall = useCallback(() => {
    const caller = callerInfo;
    if (!caller) return;

    console.log(`🔌 [useWebRTC:REJECT_CALL] Từ chối cuộc gọi từ ${caller.id}`);
    stopRingtone();
    if (socketRef.current) {
      socketRef.current.emit('reject_call', { toUserId: caller.id });
    }
    storeResetCall();
  }, [callerInfo, socketRef, storeResetCall]);

  // 6. Gửi WebRTC Offer (Caller thực hiện sau khi Receiver bấm đồng ý)
  const initiateOffer = useCallback(async (peerId: number) => {
    console.log('🔌 [useWebRTC:OFFER] Bắt đầu tạo SDP Offer gửi tới:', peerId);
    stopRingtone(); // Tắt đổ chuông gọi đi

    try {
      const pc = createPeerConnection(peerId);
      
      // Thêm local tracks vào peer connection
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track: any) => {
          pc.addTrack(track, localStreamRef.current);
        });
      }

      // Tạo SDP Offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (socketRef.current) {
        socketRef.current.emit('offer', {
          toUserId: peerId,
          offer,
        });
      }
    } catch (e) {
      console.error('❌ [useWebRTC:OFFER] Lỗi khởi tạo offer:', e);
      handleHangUp(true);
    }
  }, [createPeerConnection, socketRef]);

  // 7. Nhận Offer (Receiver nhận và tạo SDP Answer)
  const handleOffer = useCallback(async (offer: any) => {
    const peerId = peerUserIdRef.current;
    if (!peerId || !pcRef.current) return;

    console.log('🔌 [useWebRTC:ANSWER] Nhận Offer, đang tiến hành cấu hình SDP Answer...');
    try {
      const pc = pcRef.current;
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      if (socketRef.current) {
        socketRef.current.emit('answer', {
          toUserId: peerId,
          answer,
        });
      }
    } catch (e) {
      console.error('❌ [useWebRTC:ANSWER] Lỗi tạo Answer:', e);
      handleHangUp(true);
    }
  }, [socketRef]);

  // 8. Nhận Answer (Caller nhận và hoàn tất handshake)
  const handleAnswer = useCallback(async (answer: any) => {
    if (!pcRef.current) return;
    console.log('🔌 [useWebRTC:HANDSHAKE] Nhận Answer, hoàn tất đàm phán WebRTC!');
    try {
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (e) {
      console.error('❌ [useWebRTC:HANDSHAKE] Lỗi cấu hình remote answer:', e);
      handleHangUp(true);
    }
  }, []);

  // 9. Nhận ICE candidate
  const handleIceCandidate = useCallback(async (candidate: any) => {
    if (!pcRef.current) return;
    try {
      await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      // console.error('❌ [useWebRTC:ICE] Lỗi nạp ICE candidate:', e);
    }
  }, []);

  // 10. Tắt cuộc gọi (Hang Up)
  const handleHangUp = useCallback((notifyPeer = true) => {
    const peerId = peerUserIdRef.current;
    console.log('🔌 [useWebRTC:HANGUP] Cúp máy cuộc gọi. Báo đầu kia?', notifyPeer, 'PeerID:', peerId);
    
    stopRingtone();

    // 1. Thông báo cho đối phương
    if (notifyPeer && peerId && socketRef.current) {
      socketRef.current.emit('end_call', { toUserId: peerId });
    }

    // 2. Dừng tất cả stream cục bộ
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track: any) => {
        track.stop();
      });
      localStreamRef.current = null;
    }
    setLocalStream(null);

    // 3. Dừng stream từ đối phương
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((track: any) => {
        track.stop();
      });
      remoteStreamRef.current = null;
    }
    setRemoteStream(null);

    // 4. Đóng Peer Connection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    peerUserIdRef.current = null;
    storeResetCall();
  }, [socketRef, storeResetCall]);

  // 11. Các chức năng bổ trợ bật tắt mic/cam
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        storeSetMuted(!audioTrack.enabled);
      }
    }
  }, [storeSetMuted]);

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current && callType === 'video') {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        storeSetVideoOff(!videoTrack.enabled);
      }
    }
  }, [callType, storeSetVideoOff]);

  // Giải phóng tài nguyên khi unmount hook
  useEffect(() => {
    return () => {
      stopRingtone();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track: any) => track.stop());
      }
      if (remoteStreamRef.current) {
        remoteStreamRef.current.getTracks().forEach((track: any) => track.stop());
      }
      if (pcRef.current) {
        pcRef.current.close();
      }
    };
  }, []);

  return {
    localStream,
    remoteStream,
    startCall,
    acceptCall,
    rejectCall,
    initiateOffer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    handleHangUp,
    toggleMute,
    toggleVideo,
    callState,
    callType,
    callerInfo,
    targetInfo,
    isMuted,
    isVideoOff,
  };
};
