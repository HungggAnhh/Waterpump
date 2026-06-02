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
  const iceQueueRef = useRef<any[]>([]);

  // 1. Tạo Peer Connection
  const createPeerConnection = useCallback((peerId: number) => {
    console.log(`🔌 [useWebRTC:CREATE_PC] Khởi tạo RTCPeerConnection cho user: ${peerId}`);
    
    if (pcRef.current) {
      console.warn('⚠️ [useWebRTC:CREATE_PC] PeerConnection đã tồn tại, tiến hành đóng lại trước...');
      try {
        pcRef.current.close();
      } catch (err) {
        console.error('❌ [useWebRTC:CREATE_PC] Lỗi khi đóng PeerConnection cũ:', err);
      }
      pcRef.current = null;
    }

    // Nạp cấu hình iceServers chính thức
    console.log('🔌 [useWebRTC:CREATE_PC] Sử dụng cấu hình iceServers:', JSON.stringify(configuration.iceServers.map(s => s.urls)));
    const pc = new RTCPeerConnection(configuration) as any;
    pcRef.current = pc;

    // Lắng nghe sự kiện sinh ICE Candidate cục bộ
    pc.onicecandidate = (event: any) => {
      if (event.candidate) {
        console.log(`📡 [useWebRTC:ICE_GENERATE] Đã tạo thành công candidate cục bộ: IP=${event.candidate.address || event.candidate.candidate.split(' ')[4]}, Port=${event.candidate.port || event.candidate.candidate.split(' ')[5]}, Prot=${event.candidate.protocol || event.candidate.candidate.split(' ')[2]}, Type=${event.candidate.type || event.candidate.candidate.split(' ')[7]}`);
        if (socketRef.current) {
          console.log(`📡 [useWebRTC:ICE_EMIT] Gửi ICE candidate tới user ${peerId} qua Socket...`);
          socketRef.current.emit('ice_candidate', {
            toUserId: peerId,
            candidate: event.candidate,
          });
        } else {
          console.error('❌ [useWebRTC:ICE_EMIT] Socket rỗng, không thể gửi ICE candidate!');
        }
      } else {
        console.log('📡 [useWebRTC:ICE_GENERATE] Hoàn thành tiến trình thu thập ICE candidate (End of candidates)');
      }
    };

    // Lắng nghe nhận remote tracks
    pc.ontrack = (event: any) => {
      console.log('📡 [useWebRTC:ONTRACK] Nhận được track từ đối phương!', event);
      if (event.streams && event.streams[0]) {
        console.log(`📡 [useWebRTC:ONTRACK] Gán remote stream từ event.streams[0]. Tracks count: ${event.streams[0].getTracks().length}`);
        event.streams[0].getTracks().forEach((t: any) => {
          console.log(`📹 [useWebRTC:ONTRACK] Track từ xa: ID=${t.id}, Kind=${t.kind}, Enabled=${t.enabled}, State=${t.readyState}`);
        });
        remoteStreamRef.current = event.streams[0];
        setRemoteStream(event.streams[0]);
      } else {
        // Nếu trình duyệt/shim trả về stream rỗng trong tracks, tự động khởi tạo stream mới và gán track vào
        console.warn('⚠️ [useWebRTC:ONTRACK] event.streams[0] trống. Đang tạo stream thủ công từ tracks...');
        const newStream = new (window as any).MediaStream();
        newStream.addTrack(event.track);
        remoteStreamRef.current = newStream;
        setRemoteStream(newStream);
      }
    };

    // Fallback cho một số phiên bản React Native WebRTC cũ
    pc.onaddstream = (event: any) => {
      console.log('📡 [useWebRTC:ONADDSTREAM] Nhận remote stream (onaddstream):', event.stream);
      if (event.stream) {
        event.stream.getTracks().forEach((t: any) => {
          console.log(`📹 [useWebRTC:ONADDSTREAM] Track từ xa (onaddstream): ID=${t.id}, Kind=${t.kind}, Enabled=${t.enabled}`);
        });
        remoteStreamRef.current = event.stream;
        setRemoteStream(event.stream);
      }
    };

    // Giám sát trạng thái kết nối WebRTC tổng thể
    pc.onconnectionstatechange = () => {
      console.log(`📡 [useWebRTC:STATE_CHANGE] Connection State của PeerConnection thay đổi: =====> ${pc.connectionState} <=====`);
      if (pc.connectionState === 'connected') {
        console.log('🎉 [useWebRTC:STATE_CHANGE] Cuộc gọi đã kết nối thành công (WebRTC Connected)!');
        storeSetConnected();
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        console.warn(`🚨 [useWebRTC:STATE_CHANGE] Kết nối bị ngắt quãng hoặc thất bại (state: ${pc.connectionState}). Tiến hành dọn dẹp...`);
        handleHangUp(false);
      }
    };

    // Giám sát trạng thái kết nối ICE
    pc.oniceconnectionstatechange = () => {
      console.log(`📡 [useWebRTC:ICE_STATE_CHANGE] ICE Connection State: =====> ${pc.iceConnectionState} <=====`);
      if (pc.iceConnectionState === 'failed') {
        console.error('🚨 [useWebRTC:ICE_STATE_CHANGE] Kết nối ICE thất bại hoàn toàn. Thử ngắt và cúp máy...');
        handleHangUp(true);
      }
    };

    // Giám sát trạng thái thương lượng SDP
    pc.onsignalingstatechange = () => {
      console.log(`📡 [useWebRTC:SIGNALING_STATE_CHANGE] Signaling State: =====> ${pc.signalingState} <=====`);
    };

    // Giám sát trạng thái thu thập ICE
    pc.onicegatheringstatechange = () => {
      console.log(`📡 [useWebRTC:ICE_GATHERING_CHANGE] ICE Gathering State: =====> ${pc.iceGatheringState} <=====`);
    };

    return pc;
  }, [socketRef, storeSetConnected]);

  // 2. Thu thập luồng camera & mic nội bộ
  const acquireMedia = useCallback(async (type: CallType) => {
    console.log(`🔌 [useWebRTC:ACQUIRE_MEDIA] Yêu cầu luồng media cục bộ, Kiểu cuộc gọi: ${type}`);
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

      console.log('🔌 [useWebRTC:ACQUIRE_MEDIA] Yêu cầu getUserMedia với constraints:', JSON.stringify(constraints));
      let stream;
      try {
        stream = await mediaDevices.getUserMedia(constraints);
      } catch (err) {
        if (type === 'video') {
          console.warn('⚠️ [useWebRTC:ACQUIRE_MEDIA] getUserMedia với constraints chi tiết bị từ chối. Thử chế độ tối giản {audio: true, video: true}...', err);
          stream = await mediaDevices.getUserMedia({ audio: true, video: true });
        } else {
          throw err;
        }
      }
      
      console.log('🔌 [useWebRTC:ACQUIRE_MEDIA] Đã lấy luồng media cục bộ thành công!');
      stream.getTracks().forEach((track: any) => {
        console.log(`📹 [useWebRTC:ACQUIRE_MEDIA] Track cục bộ: ID=${track.id}, Kind=${track.kind}, Enabled=${track.enabled}, ReadyState=${track.readyState}`);
      });
      
      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    } catch (e: any) {
      console.error('❌ [useWebRTC:ACQUIRE_MEDIA] Lỗi nghiêm trọng khi thu thập camera/mic:', e);
      Alert.alert('Quyền truy cập', 'Không thể mở Camera/Mic của thiết bị. Hãy kiểm tra cài đặt quyền.');
      throw e;
    }
  }, []);

  // 3. Khởi tạo cuộc gọi (Caller)
  const startCall = useCallback(async (targetUser: CallUserInfo, type: CallType, conversationId?: string) => {
    console.log(`🔌 [useWebRTC:START_CALL] Bắt đầu thực hiện cuộc gọi tới user: ${targetUser.id} (${targetUser.name})`);
    peerUserIdRef.current = targetUser.id;
    
    // Đặt trạng thái store sang calling
    storeStartCall(targetUser, type, conversationId);
    playRingtone(); // Đổ chuông gọi đi

    try {
      // 1. Lấy luồng mic/camera trước
      console.log('🔌 [useWebRTC:START_CALL] Tiến hành lấy luồng media cục bộ (acquireMedia)...');
      const stream = await acquireMedia(type);
      console.log(`🔌 [useWebRTC:START_CALL] Lấy luồng media cục bộ thành công! Số lượng tracks: ${stream.getTracks().length}`);

      // 2. Gửi tín hiệu gọi điện qua socket
      if (socketRef.current) {
        console.log('📡 [useWebRTC:START_CALL:EMIT] Gửi tín hiệu "call_user" lên Server...');
        socketRef.current.emit('call_user', {
          toUserId: targetUser.id,
          callerInfo: currentUser,
          callType: type,
          conversationId,
        });
      } else {
        console.error('❌ [useWebRTC:START_CALL] Socket rỗng! Không thể gửi tín hiệu gọi điện.');
      }
    } catch (e) {
      console.error('❌ [useWebRTC:START_CALL] Gặp lỗi khi khởi tạo cuộc gọi:', e);
      handleHangUp(true);
    }
  }, [currentUser, socketRef, storeStartCall, acquireMedia]);

  // 4. Chấp nhận cuộc gọi (Receiver)
  const acceptCall = useCallback(async () => {
    const caller = callerInfo;
    const type = callType;
    if (!caller || !type) {
      console.error('❌ [useWebRTC:ACCEPT_CALL] Thông tin callerInfo hoặc callType bị trống!', { caller, type });
      return;
    }

    console.log(`🔌 [useWebRTC:ACCEPT_CALL] Chấp nhận cuộc gọi từ callerId: ${caller.id}`);
    peerUserIdRef.current = caller.id;
    stopRingtone();

    try {
      // Lấy camera / mic
      console.log('🔌 [useWebRTC:ACCEPT_CALL] Tiến hành lấy luồng media cục bộ (acquireMedia)...');
      const stream = await acquireMedia(type);
      console.log(`🔌 [useWebRTC:ACCEPT_CALL] Lấy luồng media cục bộ thành công! Số lượng tracks: ${stream.getTracks().length}`);

      // Gửi tín hiệu chấp nhận cuộc gọi
      if (socketRef.current) {
        console.log('📡 [useWebRTC:ACCEPT_CALL:EMIT] Gửi tín hiệu "accept_call" lên Server...');
        socketRef.current.emit('accept_call', { toUserId: caller.id });
      } else {
        console.error('❌ [useWebRTC:ACCEPT_CALL] Socket rỗng, không thể gửi tín hiệu chấp nhận.');
      }

      // Tạo peer connection và add tracks
      console.log('🔌 [useWebRTC:ACCEPT_CALL] Khởi tạo RTCPeerConnection...');
      const pc = createPeerConnection(caller.id);
      
      console.log('🔌 [useWebRTC:ACCEPT_CALL] Tiến hành nạp tracks cục bộ vào PeerConnection...');
      stream.getTracks().forEach((track: any) => {
        console.log(`📹 [useWebRTC:ACCEPT_CALL] Nạp track: Kind=${track.kind}, ID=${track.id}`);
        pc.addTrack(track, stream);
      });

      console.log('🔌 [useWebRTC:ACCEPT_CALL] Hoàn tất nạp tracks, thiết lập trạng thái store thành connected.');
      storeSetConnected();
    } catch (e) {
      console.error('❌ [useWebRTC:ACCEPT_CALL] Gặp lỗi khi chấp nhận cuộc gọi:', e);
      handleHangUp(true);
    }
  }, [callerInfo, callType, acquireMedia, socketRef, createPeerConnection, storeSetConnected]);

  // 5. Từ chối cuộc gọi (Receiver)
  const rejectCall = useCallback(() => {
    const caller = callerInfo;
    if (!caller) {
      console.error('❌ [useWebRTC:REJECT_CALL] Không có thông tin cuộc gọi đến để từ chối!');
      return;
    }

    console.log(`🔌 [useWebRTC:REJECT_CALL] Từ chối cuộc gọi từ user: ${caller.id}`);
    stopRingtone();
    if (socketRef.current) {
      console.log('📡 [useWebRTC:REJECT_CALL:EMIT] Gửi tín hiệu "reject_call" lên Server...');
      socketRef.current.emit('reject_call', { toUserId: caller.id });
    }
    storeResetCall();
  }, [callerInfo, socketRef, storeResetCall]);

  // 6. Gửi WebRTC Offer (Caller thực hiện sau khi Receiver bấm đồng ý)
  const initiateOffer = useCallback(async (peerId: number) => {
    console.log(`🔌 [useWebRTC:OFFER] Tiến hành tạo và gửi SDP Offer tới đối phương: ${peerId}`);
    stopRingtone(); // Tắt đổ chuông gọi đi

    try {
      console.log('🔌 [useWebRTC:OFFER] Khởi tạo RTCPeerConnection...');
      const pc = createPeerConnection(peerId);
      
      // Thêm local tracks vào peer connection
      if (localStreamRef.current) {
        console.log(`🔌 [useWebRTC:OFFER] Tiến hành nạp tracks cục bộ (tổng: ${localStreamRef.current.getTracks().length}) vào PeerConnection...`);
        localStreamRef.current.getTracks().forEach((track: any) => {
          console.log(`📹 [useWebRTC:OFFER] Nạp track: Kind=${track.kind}, ID=${track.id}`);
          pc.addTrack(track, localStreamRef.current);
        });
      } else {
        console.warn('⚠️ [useWebRTC:OFFER] localStream cục bộ rỗng tại thời điểm tạo Offer!');
      }

      // Tạo SDP Offer
      console.log('🔌 [useWebRTC:OFFER] Bắt đầu gọi pc.createOffer()...');
      const offer = await pc.createOffer();
      console.log('🔌 [useWebRTC:OFFER] Bắt đầu gọi pc.setLocalDescription(offer)...');
      await pc.setLocalDescription(offer);

      if (socketRef.current) {
        console.log('📡 [useWebRTC:OFFER:EMIT] Gửi SDP Offer lên Server qua socket event "offer"...');
        socketRef.current.emit('offer', {
          toUserId: peerId,
          offer,
        });
      } else {
        console.error('❌ [useWebRTC:OFFER] Socket rỗng, không thể gửi SDP Offer!');
      }
    } catch (e) {
      console.error('❌ [useWebRTC:OFFER] Lỗi nghiêm trọng khi khởi tạo offer:', e);
      handleHangUp(true);
    }
  }, [createPeerConnection, socketRef]);

  // Helper to process queued ICE candidates once remoteDescription is set
  const processIceQueue = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
      console.warn('⚠️ [useWebRTC:ICE_QUEUE] Chưa thể xử lý hàng đợi ICE do remoteDescription chưa sẵn sàng.');
      return;
    }

    console.log(`🔌 [useWebRTC:ICE_QUEUE] Bắt đầu xử lý ${iceQueueRef.current.length} ICE candidates đang chờ...`);
    const candidates = [...iceQueueRef.current];
    iceQueueRef.current = [];

    for (const candidate of candidates) {
      try {
        console.log(`📡 [useWebRTC:ICE_QUEUE:APPLY] Đang nạp candidate từ hàng đợi: Candidate=${candidate.candidate || candidate}`);
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('📡 [useWebRTC:ICE_QUEUE:APPLY] Nạp candidate thành công!');
      } catch (e) {
        console.error('❌ [useWebRTC:ICE_QUEUE:APPLY] Thất bại khi nạp candidate từ hàng đợi:', e);
      }
    }
  }, []);

  // 7. Nhận Offer (Receiver nhận và tạo SDP Answer)
  const handleOffer = useCallback(async (offer: any) => {
    const peerId = peerUserIdRef.current;
    console.log('🔌 [useWebRTC:ANSWER] handleOffer được gọi. Trạng thái PC hiện tại:', pcRef.current ? 'Sẵn sàng' : 'Chưa khởi tạo');
    if (!peerId || !pcRef.current) {
      console.error('❌ [useWebRTC:ANSWER] Thất bại: Không có peerId hoặc pcRef.current rỗng trong handleOffer!', { peerId, pcExists: !!pcRef.current });
      return;
    }

    console.log('🔌 [useWebRTC:ANSWER] Nhận Offer, đang cấu hình setRemoteDescription với Offer SDP...');
    try {
      const pc = pcRef.current;
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      console.log('🔌 [useWebRTC:ANSWER] Cấu hình setRemoteDescription thành công! Đang tạo Answer...');

      const answer = await pc.createAnswer();
      console.log('🔌 [useWebRTC:ANSWER] Đã tạo thành công Answer SDP. Bắt đầu gọi setLocalDescription...');
      await pc.setLocalDescription(answer);
      console.log('🔌 [useWebRTC:ANSWER] Cấu hình setLocalDescription (Answer) thành công!');

      if (socketRef.current) {
        console.log('📡 [useWebRTC:ANSWER:EMIT] Gửi SDP Answer lên Server qua socket event "answer"...');
        socketRef.current.emit('answer', {
          toUserId: peerId,
          answer,
        });
      } else {
        console.error('❌ [useWebRTC:ANSWER] Socket rỗng, không thể gửi SDP Answer!');
      }

      // Xử lý các candidate được lưu trữ trong hàng đợi
      await processIceQueue();
    } catch (e) {
      console.error('❌ [useWebRTC:ANSWER] Lỗi nghiêm trọng khi tạo hoặc cấu hình Answer:', e);
      handleHangUp(true);
    }
  }, [socketRef, processIceQueue]);

  // 8. Nhận Answer (Caller nhận và hoàn tất handshake)
  const handleAnswer = useCallback(async (answer: any) => {
    console.log('🔌 [useWebRTC:HANDSHAKE] handleAnswer được gọi. Trạng thái PC hiện tại:', pcRef.current ? 'Sẵn sàng' : 'Chưa khởi tạo');
    if (!pcRef.current) {
      console.error('❌ [useWebRTC:HANDSHAKE] Thất bại: pcRef.current bị rỗng trong handleAnswer!');
      return;
    }
    
    console.log('🔌 [useWebRTC:HANDSHAKE] Bắt đầu gọi setRemoteDescription với Answer SDP...');
    try {
      const pc = pcRef.current;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('🔌 [useWebRTC:HANDSHAKE] Thương lượng SDP thành công! Kết nối WebRTC đã hoàn tất đàm phán.');

      // Xử lý các candidate được lưu trữ trong hàng đợi
      await processIceQueue();
    } catch (e) {
      console.error('❌ [useWebRTC:HANDSHAKE] Lỗi nghiêm trọng khi cấu hình remote answer:', e);
      handleHangUp(true);
    }
  }, [processIceQueue]);

  // 9. Nhận ICE candidate
  const handleIceCandidate = useCallback(async (candidate: any) => {
    const pc = pcRef.current;
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
      try {
        console.log(`📡 [useWebRTC:ICE_RECEIVE:APPLY] Đang nạp ICE candidate trực tiếp: IP=${candidate.address || candidate.candidate?.split(' ')[4]}, Type=${candidate.type || candidate.candidate?.split(' ')[7]}`);
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        // console.log('📡 [useWebRTC:ICE_RECEIVE:APPLY] Nạp candidate trực tiếp thành công!');
      } catch (e) {
        console.error('❌ [useWebRTC:ICE_RECEIVE:APPLY] Lỗi khi nạp ICE candidate trực tiếp:', e);
      }
    } else {
      console.log(`📡 [useWebRTC:ICE_RECEIVE:QUEUE] Remote description chưa được gán. Đưa ICE candidate vào hàng đợi tạm thời. Tổng đợi: ${iceQueueRef.current.length + 1}`);
      // Lưu lại candidate vào hàng đợi nếu remote description chưa được set
      iceQueueRef.current.push(candidate);
    }
  }, []);

  // 10. Tắt cuộc gọi (Hang Up)
  const handleHangUp = useCallback((notifyPeer = true) => {
    const peerId = peerUserIdRef.current;
    console.log('🔌 [useWebRTC:HANGUP] Cúp máy cuộc gọi. Báo đầu kia?', notifyPeer, 'PeerID:', peerId);
    
    stopRingtone();
    iceQueueRef.current = []; // Xóa sạch hàng đợi ICE

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
