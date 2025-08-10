// BeeMoo - RTC Signaling Helper
// Wraps socket for offer/answer/ice exchange

export class RTCSignaling {
  constructor(socketClient) {
    this.socket = socketClient;
    this.handlers = {
      offer: null,
      answer: null,
      ice: null,
    };
  }

  onOffer(handler) {
    this.handlers.offer = handler;
    this.socket.on('webrtc-offer', handler);
  }

  onAnswer(handler) {
    this.handlers.answer = handler;
    this.socket.on('webrtc-answer', handler);
  }

  onIceCandidate(handler) {
    this.handlers.ice = handler;
    this.socket.on('webrtc-ice-candidate', handler);
  }

  offAll() {
    if (this.handlers.offer) this.socket.off('webrtc-offer', this.handlers.offer);
    if (this.handlers.answer) this.socket.off('webrtc-answer', this.handlers.answer);
    if (this.handlers.ice) this.socket.off('webrtc-ice-candidate', this.handlers.ice);
    this.handlers = { offer: null, answer: null, ice: null };
  }

  sendOffer(sdp, to) {
    this.socket.emit('webrtc-offer', { sdp, to });
  }

  sendAnswer(sdp, to) {
    this.socket.emit('webrtc-answer', { sdp, to });
  }

  sendIceCandidate(candidate, to) {
    this.socket.emit('webrtc-ice-candidate', { candidate, to });
  }
}
