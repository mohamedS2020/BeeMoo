// BeeMoo - Peer Manager
// Manages per-peer RTCPeerConnection and integrates with RTCSignaling

import { RTCSignaling } from './rtcSignaling.js';

export class PeerManager {
  constructor(socketClient, localStreamProvider) {
    this.socketClient = socketClient;
    this.signaling = new RTCSignaling(socketClient);
    this.peerIdToPc = new Map();
    this.localStreamProvider = localStreamProvider; // () => Promise<MediaStream>
    this.onRemoteTrack = null; // (peerId, MediaStream) => void
    this.currentLocalStream = null;

    // Bind signaling events
    this.signaling.onOffer(async ({ from, sdp }) => {
      await this.handleOffer(from, sdp);
    });
    this.signaling.onAnswer(async ({ from, sdp }) => {
      await this.handleAnswer(from, sdp);
    });
    this.signaling.onIceCandidate(async ({ from, candidate }) => {
      const pc = this.peerIdToPc.get(from);
      if (pc && candidate) {
        try { await pc.addIceCandidate(candidate); } catch {}
      }
    });
  }

  async ensurePeer(peerId) {
    if (this.peerIdToPc.has(peerId)) return this.peerIdToPc.get(peerId);

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    });

    pc.onicecandidate = (evt) => {
      if (evt.candidate) {
        this.signaling.sendIceCandidate(evt.candidate, peerId);
      }
    };

    pc.ontrack = (evt) => {
      if (this.onRemoteTrack && evt.streams && evt.streams[0]) {
        this.onRemoteTrack(peerId, evt.streams[0]);
      }
    };

    // Attach local tracks
    const local = await this._getOrCreateLocalStream();
    local.getTracks().forEach(t => pc.addTrack(t, local));

    this.peerIdToPc.set(peerId, pc);
    return pc;
  }

  async callPeer(peerId) {
    const pc = await this.ensurePeer(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signaling.sendOffer(offer, peerId);
  }

  async handleOffer(fromPeerId, sdp) {
    const pc = await this.ensurePeer(fromPeerId);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.signaling.sendAnswer(answer, fromPeerId);
  }

  async handleAnswer(fromPeerId, sdp) {
    const pc = this.peerIdToPc.get(fromPeerId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  closePeer(peerId) {
    const pc = this.peerIdToPc.get(peerId);
    if (pc) {
      pc.getSenders().forEach(s => { try { pc.removeTrack(s); } catch {} });
      pc.close();
      this.peerIdToPc.delete(peerId);
    }
  }

  async replaceLocalStream(newStream) {
    this.currentLocalStream = newStream;
    for (const pc of this.peerIdToPc.values()) {
      const senders = pc.getSenders().filter(s => s.track && s.track.kind === 'audio');
      const newTrack = newStream.getAudioTracks()[0];
      for (const s of senders) {
        try { await s.replaceTrack(newTrack); } catch {}
      }
    }
  }

  async _getOrCreateLocalStream() {
    if (this.currentLocalStream) return this.currentLocalStream;
    this.currentLocalStream = await this.localStreamProvider();
    return this.currentLocalStream;
  }

  destroy() {
    for (const peerId of Array.from(this.peerIdToPc.keys())) {
      this.closePeer(peerId);
    }
    this.signaling.offAll();
  }
}
