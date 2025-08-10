// BeeMoo - Room View
// Minimal scaffold that hosts the participant list and room header

import { ParticipantList } from './ParticipantList.js';
import { WebRTCUtils } from '../utils/webrtc.js';
import { PeerManager } from '../utils/peerManager.js';

export class RoomView {
  constructor(socketClient) {
    this.socketClient = socketClient;
    this.root = null;
    this.participantList = new ParticipantList(socketClient);
    this.peerManager = null;
    this.voiceActive = false;
    this.participants = new Map();
    this.boundHandlers = false;
  }

  mount(container, initialData) {
    if (!container) return;
    this.root = container;
    this.root.innerHTML = this.render(initialData);

    const participantsContainer = this.root.querySelector('#participants-container');
    this.participantList.attach(participantsContainer);

    if (initialData?.participants) {
      this.participantList.setParticipants(initialData.participants);
      for (const p of initialData.participants) {
        if (p && p.socketId) this.participants.set(p.socketId, p);
      }
    }

    // Minimal mic permission CTA (non-blocking)
    const micBtn = this.root.querySelector('#request-mic');
    if (micBtn) {
      micBtn.addEventListener('click', async () => {
        micBtn.disabled = true;
        const res = await WebRTCUtils.requestMicrophonePermissions();
        if (!res.granted) {
          alert('Microphone permission denied. You can enable it later from browser settings.');
        }
        const list = await WebRTCUtils.listAudioInputDevices();
        console.log('🎙️ Devices:', list);
        micBtn.disabled = false;
      });
    }

    // Initialize PeerManager with a local stream provider
    this.peerManager = new PeerManager(this.socketClient, async () => {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (e) {
        console.warn('Microphone not available, using silent stream');
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const dest = ctx.createMediaStreamDestination();
        return dest.stream; // silent stream
      }
    });

    // Render remote audio when tracks arrive
    this.peerManager.onRemoteTrack = (peerId, stream) => {
      let el = this.root.querySelector(`audio[data-peer="${peerId}"]`);
      if (!el) {
        el = document.createElement('audio');
        el.dataset.peer = peerId;
        el.autoplay = true;
        el.playsInline = true;
        this.root.appendChild(el);
      }
      el.srcObject = stream;
    };

    // Hook participant-volume changes to adjust remote audio elements
    this.participantList.onVolumeChange = (socketId, volume) => {
      const el = this.root.querySelector(`audio[data-peer="${socketId}"]`);
      if (el) el.volume = volume;
    };

    // Bind participant events
    this.bindRoomParticipantEvents();

    // Voice toggle
    const voiceBtn = this.root.querySelector('#toggle-voice');
    if (voiceBtn) {
      voiceBtn.addEventListener('click', async () => {
        if (this.voiceActive) {
          this.stopVoice();
          voiceBtn.textContent = 'Start Voice';
        } else {
          await this.startVoice();
          voiceBtn.textContent = 'Stop Voice';
        }
      });
    }

    // Populate devices and bind audio controls
    this.populateMicDevices();
    const micToggle = this.root.querySelector('#mic-toggle');
    const applyBtn = this.root.querySelector('#apply-audio');
    micToggle?.addEventListener('click', () => this.toggleMic(micToggle));
    applyBtn?.addEventListener('click', () => this.applyAudioSettings());
  }

  unmount() {
    if (this.participantList) this.participantList.destroy();
    if (this.peerManager) this.peerManager.destroy();
    this.unbindRoomParticipantEvents();
    if (this.root) this.root.innerHTML = '';
    this.root = null;
  }

  async populateMicDevices() {
    const select = this.root.querySelector('#mic-device');
    if (!select) return;
    const { devices } = await WebRTCUtils.listAudioInputDevices();
    select.innerHTML = '';
    (devices || []).forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || 'Microphone';
      select.appendChild(opt);
    });
  }

  async toggleMic(buttonEl) {
    const local = this.peerManager?.currentLocalStream;
    const track = local?.getAudioTracks()[0];
    if (!track) return;
    const nextEnabled = !track.enabled;
    track.enabled = nextEnabled;
    buttonEl.textContent = nextEnabled ? 'Mute Mic' : 'Unmute Mic';
    // Notify server about mic status for participant list update
    const muted = !nextEnabled;
    this.socketClient.emit('mic-toggle', { muted });
  }

  async applyAudioSettings() {
    const select = this.root.querySelector('#mic-device');
    const aec = this.root.querySelector('#aec')?.checked;
    const ns = this.root.querySelector('#ns')?.checked;
    const agc = this.root.querySelector('#agc')?.checked;
    const deviceId = select?.value || undefined;

    try {
      const constraints = WebRTCUtils.getAudioConstraints({
        echoCancellation: aec,
        noiseSuppression: ns,
        autoGainControl: agc,
        deviceId
      });
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      await this.peerManager.replaceLocalStream(newStream);
    } catch (e) {
      alert('Failed to apply audio settings. Check permissions and try again.');
    }
  }

  async startVoice() {
    this.voiceActive = true;
    const selfId = this.socketClient.socket?.id;
    for (const [peerId] of this.participants.entries()) {
      if (!peerId || peerId === selfId) continue;
      try { await this.peerManager.callPeer(peerId); } catch {}
    }
  }

  stopVoice() {
    this.voiceActive = false;
    if (this.peerManager) {
      this.peerManager.destroy();
      // Recreate
      this.peerManager = new PeerManager(this.socketClient, async () => {
        try { return await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
        catch {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const dest = ctx.createMediaStreamDestination();
          return dest.stream;
        }
      });
      this.peerManager.onRemoteTrack = (peerId, stream) => {
        let el = this.root.querySelector(`audio[data-peer="${peerId}"]`);
        if (!el) {
          el = document.createElement('audio');
          el.dataset.peer = peerId;
          el.autoplay = true;
          el.playsInline = true;
          this.root.appendChild(el);
        }
        el.srcObject = stream;
      };
    }
    this.root?.querySelectorAll('audio[data-peer]')?.forEach(el => el.remove());
  }

  bindRoomParticipantEvents() {
    if (this.boundHandlers) return;
    this._onJoined = ({ participant, participants }) => {
      if (participants) {
        for (const p of participants) this.participants.set(p.socketId, p);
      } else if (participant) {
        this.participants.set(participant.socketId, participant);
        if (this.voiceActive) this.peerManager.callPeer(participant.socketId).catch(() => {});
      }
    };
    this._onLeft = ({ participant, participants }) => {
      if (participants) {
        this.participants.clear();
        for (const p of participants) this.participants.set(p.socketId, p);
      } else if (participant) {
        this.participants.delete(participant.socketId);
        if (this.voiceActive) this.peerManager.closePeer(participant.socketId);
      }
    };
    this._onDisconnected = this._onLeft;
    this.socketClient.on('participant-joined', this._onJoined);
    this.socketClient.on('participant-left', this._onLeft);
    this.socketClient.on('participant-disconnected', this._onDisconnected);
    this.boundHandlers = true;
  }

  unbindRoomParticipantEvents() {
    if (!this.boundHandlers) return;
    this.socketClient.off('participant-joined', this._onJoined);
    this.socketClient.off('participant-left', this._onLeft);
    this.socketClient.off('participant-disconnected', this._onDisconnected);
    this.boundHandlers = false;
  }

  render(initialData) {
    const roomCode = initialData?.roomCode || '######';
    const title = initialData?.room?.title || 'BeeMoo Room';

    return `
      <section class="room-shell" aria-label="Room">
        <header class="room-header">
          <h2 class="room-title">${this.escapeHtml(title)}</h2>
          <div class="room-meta">
            <span class="room-code-inline" title="Room Code">${this.escapeHtml(roomCode)}</span>
            <button id="request-mic" class="btn btn-secondary btn-small" style="margin-left:8px">Enable Mic</button>
            <button id="toggle-voice" class="btn btn-primary btn-small" style="margin-left:8px">Start Voice</button>
          </div>
        </header>
        <div class="room-content">
          <aside class="room-sidebar" aria-label="Participants">
            <div id="participants-container"></div>
          </aside>
          <main class="room-main" aria-label="Stage">
            <div class="room-stage-placeholder">
              Movie and controls will appear here in upcoming tasks.
              <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap; justify-content:center;">
                <button id="mic-toggle" class="btn btn-secondary btn-small">Mute Mic</button>
                <select id="mic-device" class="form-input" style="max-width:260px;"></select>
                <label style="display:flex; align-items:center; gap:6px; font-size:0.9rem;">
                  <input type="checkbox" id="aec" checked /> Echo Cancellation
                </label>
                <label style="display:flex; align-items:center; gap:6px; font-size:0.9rem;">
                  <input type="checkbox" id="ns" checked /> Noise Suppression
                </label>
                <label style="display:flex; align-items:center; gap:6px; font-size:0.9rem;">
                  <input type="checkbox" id="agc" checked /> Auto Gain
                </label>
                <button id="apply-audio" class="btn btn-primary btn-small">Apply</button>
              </div>
            </div>
          </main>
        </div>
      </section>
    `;
  }

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
