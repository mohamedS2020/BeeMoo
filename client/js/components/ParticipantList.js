// BeeMoo - Participant List Component
// Renders and updates the list of participants with mic status indicators

export class ParticipantList {
  constructor(socketClient) {
    this.socketClient = socketClient;
    this.container = null;
    this.participantsBySocketId = new Map();
    this.socketIdToVolume = new Map();
    this.boundHandlers = false;
    this.onVolumeChange = null;

    // Bind methods
    this.attach = this.attach.bind(this);
    this.detach = this.detach.bind(this);
    this.destroy = this.destroy.bind(this);
    this.setParticipants = this.setParticipants.bind(this);
    this.addOrUpdateParticipant = this.addOrUpdateParticipant.bind(this);
    this.removeParticipant = this.removeParticipant.bind(this);
    this.render = this.render.bind(this);
    this.renderItem = this.renderItem.bind(this);
    this.bindSocketEvents = this.bindSocketEvents.bind(this);
    this.unbindSocketEvents = this.unbindSocketEvents.bind(this);

    // Event handlers
    this.onParticipantJoined = this.onParticipantJoined.bind(this);
    this.onParticipantLeft = this.onParticipantLeft.bind(this);
    this.onParticipantMicUpdated = this.onParticipantMicUpdated.bind(this);
    this.onParticipantDisconnected = this.onParticipantDisconnected.bind(this);
    this._onVolumeInput = this._onVolumeInput.bind(this);
  }

  attach(containerElement) {
    if (!containerElement) return;
    this.container = containerElement;
    this.container.classList.add('participants-panel');
    this.render();

    // Ensure events are bound once
    this.bindSocketEvents();
    this.container.addEventListener('input', this._onVolumeInput);
  }

  detach() {
    if (this.container) {
      this.container.removeEventListener('input', this._onVolumeInput);
      this.container.innerHTML = '';
      this.container.classList.remove('participants-panel');
    }
    this.container = null;
    this.unbindSocketEvents();
  }

  destroy() {
    this.detach();
    this.participantsBySocketId.clear();
  }

  bindSocketEvents() {
    if (this.boundHandlers) return;
    this.socketClient.on('participant-joined', this.onParticipantJoined);
    this.socketClient.on('participant-left', this.onParticipantLeft);
    this.socketClient.on('participant-mic-updated', this.onParticipantMicUpdated);
    // Update self mic immediately when server confirms
    this.socketClient.on('mic-updated', this.onParticipantMicUpdated);
    this.socketClient.on('participant-disconnected', this.onParticipantDisconnected);
    this.boundHandlers = true;
  }

  unbindSocketEvents() {
    if (!this.boundHandlers) return;
    this.socketClient.off('participant-joined', this.onParticipantJoined);
    this.socketClient.off('participant-left', this.onParticipantLeft);
    this.socketClient.off('participant-mic-updated', this.onParticipantMicUpdated);
    this.socketClient.off('mic-updated', this.onParticipantMicUpdated);
    this.socketClient.off('participant-disconnected', this.onParticipantDisconnected);
    this.boundHandlers = false;
  }

  setParticipants(participantsArray) {
    this.participantsBySocketId.clear();
    if (Array.isArray(participantsArray)) {
      for (const p of participantsArray) {
        if (p && p.socketId) {
          this.participantsBySocketId.set(p.socketId, {
            socketId: p.socketId,
            username: p.username || 'Unknown',
            isHost: Boolean(p.isHost),
            muted: typeof p.micMuted === 'boolean' ? p.micMuted : Boolean(p.muted)
          });
        }
      }
    }
    this.render();
  }

  addOrUpdateParticipant(participant) {
    if (!participant || !participant.socketId) return;
    const existing = this.participantsBySocketId.get(participant.socketId) || {};
    this.participantsBySocketId.set(participant.socketId, {
      socketId: participant.socketId,
      username: participant.username ?? existing.username ?? 'Unknown',
      isHost: participant.isHost ?? existing.isHost ?? false,
      muted: (typeof participant.micMuted === 'boolean' ? participant.micMuted : participant.muted) ?? existing.muted ?? false
    });
    this.render();
  }

  removeParticipant(participant) {
    if (!participant || !participant.socketId) return;
    this.participantsBySocketId.delete(participant.socketId);
    this.render();
  }

  onParticipantJoined(payload) {
    // payload: { participant, participants, roomInfo }
    if (payload?.participants) {
      this.setParticipants(payload.participants);
      return;
    }
    if (payload?.participant) {
      this.addOrUpdateParticipant(payload.participant);
    }
  }

  onParticipantLeft(payload) {
    // payload: { participant, participants, roomInfo }
    if (payload?.participants) {
      this.setParticipants(payload.participants);
      return;
    }
    if (payload?.participant) {
      this.removeParticipant(payload.participant);
    }
  }

  onParticipantMicUpdated(payload) {
    // payload: { participant, participants }
    if (payload?.participants) {
      this.setParticipants(payload.participants);
      return;
    }
    if (payload?.participant) {
      this.addOrUpdateParticipant(payload.participant);
    }
  }

  onParticipantDisconnected(payload) {
    // Treat similarly to left
    if (payload?.participants) {
      this.setParticipants(payload.participants);
      return;
    }
    if (payload?.participant) {
      this.removeParticipant(payload.participant);
    }
  }

  render() {
    if (!this.container) return;

    const participants = Array.from(this.participantsBySocketId.values());

    // Panel header
    const headerHtml = `
      <div class="participants-header">
        <h3 class="participants-title">Participants</h3>
        <span class="participants-count" aria-live="polite">${participants.length}</span>
      </div>
    `;

    // List items
    const listItemsHtml = participants
      .map(this.renderItem)
      .join('');

    const listHtml = `
      <ul class="participants-list" role="list">
        ${listItemsHtml || '<li class="participant empty">Waiting for participants…</li>'}
      </ul>
    `;

    this.container.innerHTML = headerHtml + listHtml;
  }

  renderItem(p) {
    const micIcon = p.muted ? '🔇' : '🎤';
    const micClass = p.muted ? 'muted' : 'live';
    const hostBadge = p.isHost ? '<span class="badge badge-host" title="Host">HOST</span>' : '';
    const volume = Math.round((this.socketIdToVolume.get(p.socketId) ?? 100));
    const safeName = this.escapeHtml(p.username);
    const ariaName = String(p.username).replace(/[<>]/g, '');

    return `
      <li class="participant" data-socket-id="${p.socketId}">
        <div class="participant-left">
          <span class="participant-avatar" aria-hidden="true">${p.username.charAt(0).toUpperCase()}</span>
          <div class="participant-info">
            <span class="participant-name">${safeName} ${hostBadge}</span>
          </div>
        </div>
        <div class="participant-right">
          <input type="range" class="participant-volume" data-socket-id="${p.socketId}" min="0" max="100" value="${volume}" aria-label="Volume for ${ariaName}" />
          <span class="participant-mic ${micClass}" aria-label="${p.muted ? 'Muted' : 'Unmuted'}">${micIcon}</span>
        </div>
      </li>
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

  _onVolumeInput(event) {
    const target = event.target;
    if (!target.classList.contains('participant-volume')) return;
    const socketId = target.getAttribute('data-socket-id');
    const vol = Math.max(0, Math.min(100, parseInt(target.value || '0', 10)));
    this.socketIdToVolume.set(socketId, vol);
    if (typeof this.onVolumeChange === 'function') {
      this.onVolumeChange(socketId, vol / 100);
    }
  }
}
